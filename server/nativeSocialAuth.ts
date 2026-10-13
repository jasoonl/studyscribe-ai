import { and, eq, gt } from "drizzle-orm";
import { appleIdentities, inviteCodes, users, type User } from "../drizzle/schema";
import { getDb, getInviteCodeByCode, getUserByEmail, getUserByGoogleId, normalizeAuthEmail, upsertUser } from "./db";
import { countRecentSignups, isOpenSignupEnabled, openSignupDailyCap } from "./openSignup";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { isSchemaMissingError } from "./schemaTolerance";
import { MIN_AGE } from "@shared/legal";

/**
 * Google and Apple sign-in from the mobile app (F1).
 *
 * The app gets an ID token from Google or Apple on the device and posts it to
 * /api/auth/google/native or /api/auth/apple/native; the token is verified
 * there (server/nativeIdentity.ts) and the verified identity lands here. The
 * rules are the web's:
 *  - login finds an existing account only, by provider id and then by a
 *    verified email address (linking it), and never creates one;
 *  - sign-up needs the age and Terms confirmations, then a valid unused
 *    invite for the same address, or open sign-up within its daily cap and a
 *    per-network limit. An existing account just signs in.
 */

export type NativeIdentity = {
  provider: "google" | "apple";
  /** Google `sub` / Apple `sub`: stable per account. */
  subject: string;
  email: string | null;
  /** Only verified addresses may match or link an existing account. */
  emailVerified: boolean;
  name: string | null;
};

type InviteRow = { code: string; email: string; isUsed: number; expiresAt: Date };

export type NativeSignupDecision = { path: "invite" } | { path: "open" } | { path: "closed"; reason: string };

/** Who may create an account. Mirrors email sign-up (`decideSignupPath` + `registerWithEmailPassword`). */
export function decideNativeSignup(input: {
  email: string | null;
  inviteCode?: string | null;
  invite?: InviteRow | null;
  openSignup: boolean;
  recentSignups: number;
  dailyCap: number;
  now?: Date;
}): NativeSignupDecision {
  const now = input.now ?? new Date();
  if (!input.email) return { path: "closed", reason: "We need an email address to create your account. Allow sharing your email, or sign up with email and password." };
  const code = input.inviteCode?.trim();
  if (code) {
    const invite = input.invite;
    if (!invite) return { path: "closed", reason: "That invite code is not valid." };
    if (invite.isUsed) return { path: "closed", reason: "That invite code has already been used." };
    if (now > invite.expiresAt) return { path: "closed", reason: "That invite code has expired. Ask for a new one." };
    if (normalizeAuthEmail(invite.email) !== normalizeAuthEmail(input.email)) {
      return { path: "closed", reason: "This invite is for a different email address. Sign in with the account for that address, or ask for a new invite." };
    }
    return { path: "invite" };
  }
  if (!input.openSignup) return { path: "closed", reason: "An invite code is required to sign up." };
  if (input.recentSignups >= input.dailyCap) {
    return { path: "closed", reason: "Sign-ups are paused for today because of unusually high demand. Try again tomorrow, or ask for an invite." };
  }
  return { path: "open" };
}

export type NativeAuthDeps = {
  findByProvider: (identity: NativeIdentity) => Promise<User | null>;
  findByEmail: (email: string) => Promise<User | null>;
  link: (user: User, identity: NativeIdentity) => Promise<void>;
  touch: (user: User) => Promise<void>;
  create: (identity: NativeIdentity) => Promise<User | null>;
  getInvite: (code: string) => Promise<InviteRow | null>;
  claimInvite: (code: string) => Promise<boolean>;
  releaseInvite: (code: string) => Promise<void>;
  recordInviteUser: (code: string, userId: number) => Promise<void>;
  openSignup: () => Promise<boolean>;
  recentSignups: () => Promise<number>;
  dailyCap: () => number;
  allowFromNetwork: (ip: string) => boolean;
};

const providerLabel = (identity: NativeIdentity) => (identity.provider === "google" ? "Google" : "Apple");

export async function completeNativeSocialAuth(
  identity: NativeIdentity,
  request: { mode: "login" | "signup"; inviteCode?: string | null; consented?: boolean; ip: string },
  deps: NativeAuthDeps = defaultDeps,
): Promise<{ user: User; created: boolean } | { error: string; status: number }> {
  let user = await deps.findByProvider(identity);
  if (!user && identity.email && identity.emailVerified) {
    user = await deps.findByEmail(identity.email);
    if (user) await deps.link(user, identity);
  }
  if (user) {
    await deps.touch(user);
    return { user, created: false };
  }

  if (request.mode === "login") {
    return { error: `No StudyScribe account uses this ${providerLabel(identity)} account yet. Sign up with your invite first.`, status: 401 };
  }
  if (request.consented !== true) {
    return { error: `To sign up, confirm you are at least ${MIN_AGE} and accept the Terms.`, status: 400 };
  }

  const code = request.inviteCode?.trim().slice(0, 64) || null;
  const invite = code ? await deps.getInvite(code) : null;
  const openSignup = code ? false : await deps.openSignup();
  const decision = decideNativeSignup({
    email: identity.email,
    inviteCode: code,
    invite,
    openSignup,
    recentSignups: openSignup ? await deps.recentSignups() : 0,
    dailyCap: deps.dailyCap(),
  });
  if (decision.path === "closed") return { error: decision.reason, status: 400 };

  if (decision.path === "open") {
    if (!deps.allowFromNetwork(request.ip)) return { error: "Too many accounts created from this network. Try again in an hour.", status: 429 };
    const created = await deps.create(identity);
    return created ? { user: created, created: true } : { error: "Could not create the account. Please try again.", status: 500 };
  }

  // Invite: claimed before the account exists so two sign-ups cannot share it, given back on failure.
  if (!(await deps.claimInvite(code!))) return { error: "That invite code has already been used.", status: 400 };
  let created: User | null = null;
  try {
    created = await deps.create(identity);
  } catch (error) {
    await deps.releaseInvite(code!);
    throw error;
  }
  if (!created) {
    await deps.releaseInvite(code!);
    return { error: "Could not create the account. Please try again.", status: 500 };
  }
  await deps.recordInviteUser(code!, created.id);
  return { user: created, created: true };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function findAppleUser(subject: string): Promise<User | null> {
  const db = await requireDb();
  try {
    const [row] = await db.select({ userId: appleIdentities.userId }).from(appleIdentities).where(eq(appleIdentities.appleSub, subject)).limit(1);
    if (!row) return null;
    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    return user ?? null;
  } catch (error) {
    if (isSchemaMissingError(error)) return null;
    throw error;
  }
}

async function linkApple(userId: number, identity: NativeIdentity) {
  const db = await requireDb();
  try {
    await db
      .insert(appleIdentities)
      .values({ userId, appleSub: identity.subject, email: identity.email })
      .onDuplicateKeyUpdate({ set: { userId } });
  } catch (error) {
    if (isSchemaMissingError(error)) {
      throw new Error("Sign in with Apple is not available yet. Please use email or Google for now.");
    }
    throw error;
  }
}

const defaultDeps: NativeAuthDeps = {
  findByProvider: async (identity) =>
    identity.provider === "google" ? (await getUserByGoogleId(identity.subject)) ?? null : findAppleUser(identity.subject),
  findByEmail: async (email) => (await getUserByEmail(normalizeAuthEmail(email))) ?? null,
  link: async (user, identity) => {
    if (identity.provider === "google") {
      const db = await requireDb();
      await db.update(users).set({ googleId: identity.subject }).where(eq(users.id, user.id));
    } else {
      await linkApple(user.id, identity);
    }
  },
  touch: async (user) => {
    const db = await requireDb();
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  },
  create: async (identity) => {
    const email = normalizeAuthEmail(identity.email!);
    await upsertUser({
      email,
      name: identity.name || null,
      googleId: identity.provider === "google" ? identity.subject : undefined,
      loginMethod: identity.provider,
      // Both providers only hand out addresses they have verified (Apple's relay addresses included).
      emailVerified: 1,
      termsAcceptedAt: new Date(),
      lastSignedIn: new Date(),
    });
    const user = (await getUserByEmail(email)) ?? null;
    if (user && identity.provider === "apple") await linkApple(user.id, identity);
    return user;
  },
  getInvite: async (code) => (await getInviteCodeByCode(code)) ?? null,
  claimInvite: async (code) => {
    const db = await requireDb();
    const result: any = await db
      .update(inviteCodes)
      .set({ isUsed: 1, usedAt: new Date() })
      .where(and(eq(inviteCodes.code, code), eq(inviteCodes.isUsed, 0), gt(inviteCodes.expiresAt, new Date())));
    const affected = Array.isArray(result) ? result[0]?.affectedRows : result?.affectedRows;
    return Number(affected ?? 0) > 0;
  },
  releaseInvite: async (code) => {
    const db = await requireDb();
    await db.update(inviteCodes).set({ isUsed: 0, usedAt: null, usedBy: null }).where(eq(inviteCodes.code, code));
  },
  recordInviteUser: async (code, userId) => {
    const db = await requireDb();
    await db.update(inviteCodes).set({ usedBy: userId }).where(eq(inviteCodes.code, code));
  },
  openSignup: isOpenSignupEnabled,
  recentSignups: () => countRecentSignups(),
  dailyCap: () => openSignupDailyCap(),
  // Same brake as email sign-up's signupLimiter: five new accounts per network per hour.
  allowFromNetwork: (ip) => checkTrpcRateLimit(`native-signup:${ip}`, 60 * 60 * 1000, 5),
};

export async function deleteAppleIdentitiesForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(appleIdentities).where(eq(appleIdentities.userId, userId));
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
  }
}
