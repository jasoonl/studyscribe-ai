import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { organizations, users, type Organization } from "../drizzle/schema";
import { emailDomain } from "@shared/organizations";
import { getDb } from "./db";
import { getSafeApplicationOrigin } from "./email";
import { safeNextPath } from "./googleSignup";
import { ensureSsoMembership, getMembership } from "./organizations";
import { tolerateMissingSchema } from "./schemaTolerance";
import { createSessionToken, setSessionCookie } from "./sessionManager";
import { exchangeSsoCode, getWorkosConfig, profileMatchesTeam, ssoAuthorizeUrl } from "./workos";
import { checkTrpcRateLimit } from "./_core/rateLimit";

/**
 * SAML sign-in for teams through WorkOS (F3). See server/workos.ts.
 * The state is a signed, 15-minute JWT naming the team, the origin, where to
 * return, and whether the age and Terms boxes were ticked (needed only when
 * the sign-in creates the account).
 */

const PURPOSE = "sso";
const secret = () => process.env.JWT_SECRET || "default-dev-secret-change-in-production";

async function teamForEmail(email: string): Promise<Organization | null> {
  const domain = emailDomain(email);
  const db = await getDb();
  if (!domain || !db) return null;
  const rows = await tolerateMissingSchema("teams", () => db.select().from(organizations).where(eq(organizations.verifiedDomain, domain)).limit(1), [] as Organization[]);
  return rows[0]?.workosOrganizationId ? rows[0] : null;
}

export function registerSsoRoutes(app: Express) {
  app.get("/api/auth/sso/start", async (req: Request, res: Response) => {
    const origin = getSafeApplicationOrigin(typeof req.query.origin === "string" ? req.query.origin : undefined);
    const fail = (message: string) => res.redirect(302, `${origin}/login?sso=1&error=${encodeURIComponent(message)}`);
    const config = getWorkosConfig();
    if (!config) return fail("Single sign-on is not set up on this server.");
    if (!checkTrpcRateLimit(`sso-start:${req.ip}`, 10 * 60 * 1000, 30)) return fail("Too many attempts. Try again in a few minutes.");
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    const team = email ? await teamForEmail(email) : null;
    if (!team) return fail("Single sign-on is not set up for that email's domain. Sign in another way, or ask your team's admin.");
    const state = jwt.sign(
      { purpose: PURPOSE, orgId: team.id, origin, next: safeNextPath(req.query.next), consented: req.query.acceptedTerms === "1" && req.query.confirmedAge === "1" },
      secret(),
      { expiresIn: "15m" },
    );
    res.redirect(302, ssoAuthorizeUrl(config, { organization: team.workosOrganizationId!, redirectUri: `${origin}/api/auth/sso/callback`, state, loginHint: email }));
  });

  app.get("/api/auth/sso/callback", async (req: Request, res: Response) => {
    let state: { orgId: number; origin: string; next: string | null; consented: boolean } | null = null;
    try {
      const data = jwt.verify(String(req.query.state ?? ""), secret()) as any;
      if (data?.purpose === PURPOSE && Number.isInteger(data.orgId)) state = data;
    } catch {
      state = null;
    }
    const origin = getSafeApplicationOrigin(state?.origin);
    const fail = (message: string) => res.redirect(302, `${origin}/login?sso=1&error=${encodeURIComponent(message)}`);
    const config = getWorkosConfig();
    if (!config || !state || typeof req.query.code !== "string") return fail("That sign-in link expired or was changed. Please try again.");
    try {
      const db = await getDb();
      if (!db) return fail("The service is temporarily unavailable.");
      const [team] = await db.select().from(organizations).where(eq(organizations.id, state.orgId)).limit(1);
      if (!team) return fail("That team no longer exists.");
      const profile = await exchangeSsoCode(config, req.query.code);
      if (!profileMatchesTeam(profile, team)) return fail("Your identity provider signed you in with an account that does not belong to this team.");

      let [user] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
      let created = false;
      if (!user) {
        // The team admitted this person, which stands in for an invite; the age and Terms confirmations are still theirs to give.
        if (!state.consented) return fail("This is your first sign-in. Tick the age and Terms boxes under Sign in with SSO, then try again.");
        await db.insert(users).values({
          email: profile.email,
          name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
          loginMethod: "sso",
          emailVerified: 1,
          termsAcceptedAt: new Date(),
          role: "user",
          lastSignedIn: new Date(),
        });
        [user] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
        created = true;
      }
      if (!user) return fail("Could not create the account. Please try again.");
      const joined = await ensureSsoMembership(team.id, user.id);
      if (!joined) {
        if (created) {
          await db.delete(users).where(eq(users.id, user.id));
          return fail("Your team has no free seat for you. Ask its admin to add one.");
        }
        const membership = await getMembership(user.id);
        if (membership && membership.org.id !== team.id) return fail("Your account is in a different team. Leave it first, or sign in another way.");
      }
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      setSessionCookie(res, createSessionToken({ userId: user.id, email: user.email, role: user.role }));
      res.redirect(302, `${origin}${state.next ?? "/dashboard"}`);
    } catch (error) {
      console.error("[sso] callback failed:", error instanceof Error ? error.message : error);
      fail("Single sign-on did not complete. Please try again.");
    }
  });
}
