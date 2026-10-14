import { eq } from "drizzle-orm";
import { appleIdentities, users, type User } from "../drizzle/schema";
import { getDb, getUserByEmail, normalizeAuthEmail } from "./db";
import { createGoogleUser, findGoogleAccount, type GoogleUser } from "./googleOAuthHandler";
import { completeGoogleSignup, defaultDeps as googleSignupDeps } from "./googleSignupFlow";
import { autoJoinByDomain } from "./organizations";
import { isSchemaMissingError } from "./schemaTolerance";
import { MIN_AGE } from "@shared/legal";

/**
 * Google and Apple sign-in from the mobile app (F1).
 *
 * The app gets an ID token from Google or Apple on the device and posts it to
 * /api/auth/google/native or /api/auth/apple/native; the token is verified
 * there (server/nativeIdentity.ts) and the verified identity lands here. The
 * rules are the web's, and the sign-up decision is the web's own code:
 *  - login finds an existing account only, by provider id and then by a
 *    verified email address (linking it), and never creates one;
 *  - sign-up needs the age and Terms confirmations, then goes through
 *    `completeGoogleSignup` (server/googleSignupFlow.ts): a valid unused
 *    invite for the same address (claimed atomically), a team's verified
 *    domain with auto-join, or open sign-up within its daily cap and
 *    per-network limit. An existing account just signs in.
 * Either way a Workspace account from a team's verified domain joins that
 * team, as on the web.
 */

export type NativeIdentity = {
  provider: "google" | "apple";
  /** Google `sub` / Apple `sub`: stable per account. */
  subject: string;
  email: string | null;
  /** Only verified addresses may match or link an existing account. */
  emailVerified: boolean;
  name: string | null;
  /** Google Workspace domain (`hd` claim); never set for Apple. */
  hostedDomain?: string;
};

export type NativeAuthDeps = {
  /** Finds the account for this identity (by provider id, then verified email, linking it) or null. */
  findAccount: (identity: NativeIdentity) => Promise<User | null>;
  /** The web's sign-up decision and account creation for a new identity. */
  signup: (identity: NativeIdentity, inviteCode: string | null, ip: string) => Promise<{ user: User; created: boolean } | { error: string }>;
  afterSignIn: (user: User, identity: NativeIdentity) => Promise<void>;
};

const providerLabel = (identity: NativeIdentity) => (identity.provider === "google" ? "Google" : "Apple");

export async function completeNativeSocialAuth(
  identity: NativeIdentity,
  request: { mode: "login" | "signup"; inviteCode?: string | null; consented?: boolean; ip: string },
  deps: NativeAuthDeps = defaultDeps,
): Promise<{ user: User; created: boolean } | { error: string; status: number }> {
  const existing = await deps.findAccount(identity);
  if (existing) {
    await deps.afterSignIn(existing, identity);
    return { user: existing, created: false };
  }

  if (request.mode === "login") {
    return { error: `No StudyScribe account uses this ${providerLabel(identity)} account yet. Sign up with your invite first.`, status: 401 };
  }
  if (request.consented !== true) {
    return { error: `To sign up, confirm you are at least ${MIN_AGE} and accept the Terms.`, status: 400 };
  }
  if (!identity.email || !identity.emailVerified) {
    return { error: `${providerLabel(identity)} did not share a verified email address. Allow sharing your email, or sign up with email and password.`, status: 400 };
  }

  const code = request.inviteCode?.trim().slice(0, 64) || null;
  const outcome = await deps.signup(identity, code, request.ip);
  if ("error" in outcome) return { error: outcome.error, status: /Too many/.test(outcome.error) ? 429 : 400 };
  await deps.afterSignIn(outcome.user, identity);
  return outcome;
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

function asGoogleUser(identity: NativeIdentity): GoogleUser {
  return { id: identity.subject, email: identity.email ?? "", name: identity.name ?? "", hostedDomain: identity.hostedDomain };
}

async function findAccount(identity: NativeIdentity): Promise<User | null> {
  if (identity.provider === "google") {
    // findGoogleAccount links by email too; only let it when Google verified the address.
    if (!identity.emailVerified) {
      const db = await requireDb();
      const [byId] = await db.select().from(users).where(eq(users.googleId, identity.subject)).limit(1);
      return byId ?? null;
    }
    return (await findGoogleAccount(asGoogleUser(identity))) ?? null;
  }
  const linked = await findAppleUser(identity.subject);
  if (linked) {
    const db = await requireDb();
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, linked.id));
    return linked;
  }
  if (!identity.email || !identity.emailVerified) return null;
  const byEmail = (await getUserByEmail(normalizeAuthEmail(identity.email))) ?? null;
  if (byEmail) await linkApple(byEmail.id, identity);
  return byEmail;
}

async function createAppleUser(identity: NativeIdentity): Promise<User | undefined> {
  const db = await requireDb();
  const email = normalizeAuthEmail(identity.email!);
  await db.insert(users).values({
    email,
    name: identity.name,
    loginMethod: "apple",
    // Apple only hands out addresses it has verified (its private relay addresses included).
    emailVerified: 1,
    termsAcceptedAt: new Date(),
    role: "user",
    lastSignedIn: new Date(),
  });
  const [created] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (created) await linkApple(created.id, identity);
  return created;
}

const defaultDeps: NativeAuthDeps = {
  findAccount,
  signup: (identity, inviteCode, ip) =>
    completeGoogleSignup(asGoogleUser(identity), inviteCode ?? undefined, ip, {
      ...googleSignupDeps,
      // The decision, invite claim and limits are the web's; only finding and creating the account differ by provider.
      findAccount: async () => (identity.provider === "google" ? findGoogleAccount(asGoogleUser(identity)) : findAccount(identity)),
      createAccount: async (googleUser) => (identity.provider === "google" ? createGoogleUser(googleUser) : createAppleUser(identity)),
    }),
  afterSignIn: async (user, identity) => {
    // A Workspace account from a team's verified domain joins that team (F3), as on the web.
    if (identity.provider === "google") await autoJoinByDomain(user, identity.hostedDomain);
  },
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
