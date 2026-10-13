import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "../drizzle/schema";
import { getAppSetting, getDb, setAppSetting } from "./db";
import { getSafeApplicationOrigin, isTransactionalEmailConfigured, sendEmailVerificationEmail } from "./email";
import { getSessionFromCookie } from "./sessionManager";
import { limitsEnforced } from "./usage";
import { needsEmailConfirmation } from "./emailConfirmation";

export { OPEN_SIGNUP_LOGIN_METHOD, needsEmailConfirmation } from "./emailConfirmation";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

/**
 * Open sign-up (F4). An admin switch in `appSettings` that lets anyone create
 * a Free account without an invite. Invites keep working either way.
 *
 * Abuse limits around it:
 *  - it can only be switched on while usage limits are enforced (billing
 *    configured, or USAGE_LIMITS_ENFORCED=true), so a free account cannot run
 *    up unlimited transcription;
 *  - sign-up is limited per IP (signupLimiter, on top of the general auth
 *    limiter) and open sign-ups stop for the day after OPEN_SIGNUP_DAILY_CAP
 *    new accounts (default 200), while invites still work;
 *  - when transactional email (Resend) is configured, accounts made through
 *    open sign-up must confirm their email before they can transcribe or use
 *    AI tools. Without Resend there is no way to send the link, so the
 *    confirmation step is skipped and the other limits carry the load.
 * Open sign-ups are marked with loginMethod "email_open" so the confirmation
 * rule never touches accounts that existed before.
 */

export const OPEN_SIGNUP_SETTING = "open_signup";
const VERIFY_PURPOSE = "verify-email";
const VERIFY_TTL = "24h";

export function openSignupDailyCap(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.OPEN_SIGNUP_DAILY_CAP);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 200;
}

export async function isOpenSignupEnabled() {
  try {
    return (await getAppSetting(OPEN_SIGNUP_SETTING))?.value === "true";
  } catch {
    return false;
  }
}

/** The one rule that decides which sign-up a request is: an invite always works; no invite works only when open. */
export function decideSignupPath(input: { inviteCode?: string | null; openSignup: boolean; recentSignups: number; dailyCap: number }):
  | { path: "invite" }
  | { path: "open" }
  | { path: "closed"; reason: string } {
  if (input.inviteCode && input.inviteCode.trim()) return { path: "invite" };
  if (!input.openSignup) return { path: "closed", reason: "An invite code is required to sign up." };
  if (input.recentSignups >= input.dailyCap) return { path: "closed", reason: "Sign-ups are paused for today because of unusually high demand. Try again tomorrow, or ask for an invite." };
  return { path: "open" };
}

/** Whether open sign-up may be switched on, and why not. */
export function canEnableOpenSignup(enforced: boolean) {
  return enforced
    ? { ok: true as const }
    : { ok: false as const, reason: "Free-plan limits are not enforced yet. Configure Stripe billing, or set USAGE_LIMITS_ENFORCED=true, before opening sign-up." };
}

export async function countRecentSignups(now = new Date()) {
  const db = await getDb();
  if (!db) return 0;
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db.select({ count: sql<string>`COUNT(*)` }).from(users).where(gte(users.createdAt, since));
  return Number(row?.count ?? 0);
}

function verifySecret() {
  return process.env.JWT_SECRET || "default-dev-secret-change-in-production";
}

export function createEmailVerificationToken(userId: number, email: string) {
  return jwt.sign({ uid: userId, email: email.toLowerCase(), purpose: VERIFY_PURPOSE }, verifySecret(), { expiresIn: VERIFY_TTL });
}

export function readEmailVerificationToken(token: string): { uid: number; email: string } | null {
  try {
    const data = jwt.verify(token, verifySecret()) as any;
    if (data?.purpose !== VERIFY_PURPOSE || typeof data.uid !== "number" || typeof data.email !== "string") return null;
    return { uid: data.uid, email: data.email };
  } catch {
    return null;
  }
}

export async function sendVerificationLink(user: { id: number; email: string }, originCandidate?: string) {
  if (!isTransactionalEmailConfigured()) return { sent: false };
  const origin = getSafeApplicationOrigin(originCandidate);
  const url = new URL("/api/auth/verify-email", origin);
  url.searchParams.set("token", createEmailVerificationToken(user.id, user.email));
  await sendEmailVerificationEmail({ to: user.email, verifyUrl: url.toString() });
  return { sent: true };
}

/** Per-IP brake on account creation, on top of the general auth limiter. */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  // Only accounts actually created count; a typo in the form does not use up the hour.
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many accounts created from this network. Try again in an hour." });
  },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many emails requested. Try again in an hour." });
  },
});

export function registerEmailVerificationRoutes(app: Express) {
  app.get("/api/auth/verify-email", async (req: Request, res: Response) => {
    const origin = getSafeApplicationOrigin(undefined);
    const token = typeof req.query.token === "string" ? readEmailVerificationToken(req.query.token) : null;
    if (!token) {
      res.redirect(302, `${origin}/login?error=${encodeURIComponent("That confirmation link is invalid or has expired. Sign in and send a new one from the dashboard.")}`);
      return;
    }
    const db = await getDb();
    if (!db) {
      res.status(503).send("Database not available");
      return;
    }
    await db.update(users).set({ emailVerified: 1 }).where(and(eq(users.id, token.uid), eq(users.email, token.email)));
    res.redirect(302, `${origin}/dashboard?verified=1`);
  });

  app.post("/api/auth/resend-verification", resendLimiter, async (req: Request, res: Response) => {
    const session = getSessionFromCookie(req);
    if (!session) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Database not available" });
      return;
    }
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user || !needsEmailConfirmation(user)) {
      res.json({ sent: false, alreadyConfirmed: true });
      return;
    }
    try {
      await sendVerificationLink(user, req.get("origin") ?? undefined);
      res.json({ sent: true });
    } catch (error) {
      console.error("[signup] verification email failed:", error instanceof Error ? error.message : error);
      res.status(503).json({ error: "The email could not be sent right now. Try again later." });
    }
  });
}

export const signupRouter = router({
  /** Public: whether anyone can sign up, so landing pages can say "Sign up free" instead of "Request access". */
  mode: publicProcedure.query(async () => ({ openSignup: await isOpenSignupEnabled() })),

  /** Whether the signed-in person still has to confirm their email (open sign-up only). */
  confirmation: protectedProcedure.query(({ ctx }) => ({ needed: needsEmailConfirmation(ctx.user), email: ctx.user.email })),

  adminStatus: adminProcedure.query(async () => {
    const enforced = limitsEnforced();
    const check = canEnableOpenSignup(enforced);
    return {
      openSignup: await isOpenSignupEnabled(),
      canEnable: check.ok,
      reason: check.ok ? null : check.reason,
      emailConfirmation: isTransactionalEmailConfigured(),
      dailyCap: openSignupDailyCap(),
      signupsLast24h: await countRecentSignups(),
    };
  }),

  setOpenSignup: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
    if (input.enabled) {
      const check = canEnableOpenSignup(limitsEnforced());
      if (!check.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: check.reason });
    }
    await setAppSetting(OPEN_SIGNUP_SETTING, input.enabled ? "true" : "false");
    return { openSignup: input.enabled };
  }),
});
