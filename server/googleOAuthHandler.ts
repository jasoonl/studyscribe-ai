import { OAuth2Client } from "google-auth-library";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { signOAuthState } from "./googleSignup";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

/**
 * The redirect URI MUST match exactly what is registered in the Google Cloud
 * Console OAuth client AND the callback route in authRoutes.ts
 * (`GET /api/auth/google/callback`).
 *
 * We build it from the request origin at runtime so it works in both local
 * development and production without hardcoding domains.
 */
export function getGoogleRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

function createClient(redirectUri: string) {
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

/**
 * GOOGLE_SIGNIN_TEST_BASE_URL points Google sign-in at a local mock
 * (scripts/dev/mock-phase5-platform.mjs) so sign-up rules can be exercised in
 * a browser. Ignored in production, where the ID token is always verified.
 */
function signInTestBase() {
  return process.env.NODE_ENV !== "production" ? process.env.GOOGLE_SIGNIN_TEST_BASE_URL?.trim().replace(/\/$/, "") || null : null;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  /** Google Workspace domain (`hd` claim); absent for personal Gmail accounts. */
  hostedDomain?: string;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<{ tokens: any; user: GoogleUser }> {
  const testBase = signInTestBase();
  if (testBase) {
    const response = await fetch(`${testBase}/google-signin-token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const payload = (await response.json()) as { sub: string; email: string; name?: string; hd?: string };
    return { tokens: {}, user: { id: payload.sub, email: payload.email, name: payload.name ?? "", hostedDomain: payload.hd?.toLowerCase() } };
  }
  try {
    const client = createClient(redirectUri);
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error("Failed to get Google user payload");
    }

    const user: GoogleUser = {
      id: payload.sub,
      email: payload.email || "",
      name: payload.name || "",
      picture: payload.picture,
      hostedDomain: typeof payload.hd === "string" ? payload.hd.toLowerCase() : undefined,
    };

    return { tokens, user };
  } catch (error) {
    throw new Error(
      `Failed to exchange Google code: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * The account a Google sign-in belongs to: by Google id, else by email
 * (Google addresses are verified, so the Google id is linked to it). Returns
 * null when there is no account, so the caller decides whether one may be made.
 */
export async function findGoogleAccount(googleUser: GoogleUser) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [byGoogleId] = await db.select().from(users).where(eq(users.googleId, googleUser.id)).limit(1);
  if (byGoogleId) {
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, byGoogleId.id));
    return byGoogleId;
  }

  const [byEmail] = await db.select().from(users).where(eq(users.email, googleUser.email.trim().toLowerCase())).limit(1);
  if (byEmail) {
    await db
      .update(users)
      .set({ googleId: googleUser.id, emailVerified: 1, updatedAt: new Date(), lastSignedIn: new Date() })
      .where(eq(users.id, byEmail.id));
    return byEmail;
  }
  return null;
}

/** Creates the account for a Google sign-up that `decideGoogleSignup` allowed. */
export async function createGoogleUser(googleUser: GoogleUser) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const email = googleUser.email.trim().toLowerCase();
  await db.insert(users).values({
    email,
    name: googleUser.name,
    googleId: googleUser.id,
    loginMethod: "google",
    emailVerified: 1,
    // Only reached from sign-up, which requires the age and Terms confirmations.
    termsAcceptedAt: new Date(),
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  });
  const [created] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return created;
}

/**
 * Generate Google OAuth URL
 */
export function getGoogleAuthUrl(origin: string, mode: "login" | "signup" = "login", redirectUri?: string, consented = false, invite?: string, next?: string, desktop?: string): string {
  const scopes = ["openid", "email", "profile"];

  // Signed, so the callback can trust the mode, the confirmations and the invite.
  const state = signOAuthState({
    origin,
    mode,
    ...(consented ? { consented: true } : {}),
    ...(mode === "signup" && invite ? { invite } : {}),
    ...(next ? { next } : {}),
    ...(desktop ? { desktop } : {}),
  });

  const finalRedirectUri = redirectUri || getGoogleRedirectUri(origin);
  const testBase = signInTestBase();
  if (testBase) return `${testBase}/google-signin-authorize?${new URLSearchParams({ redirect_uri: finalRedirectUri, state })}`;
  const client = createClient(finalRedirectUri);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state,
    prompt: "select_account",
  });

  return url;
}
