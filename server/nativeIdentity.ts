import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { NativeIdentity } from "./nativeSocialAuth";

/**
 * Verifies the ID tokens the mobile app gets from Google and Apple (F1).
 *
 * Google: the token's audience must be one of our OAuth client ids. The app
 * signs in with the iOS or Android client (GOOGLE_IOS_CLIENT_ID,
 * GOOGLE_ANDROID_CLIENT_ID); the web client (GOOGLE_CLIENT_ID) is accepted
 * too because Android's Credential Manager issues tokens for it.
 *
 * Apple: the identity token is a JWT signed with a key from Apple's JWKS,
 * issued by https://appleid.apple.com for our bundle id (APPLE_BUNDLE_IDS,
 * comma separated; default com.studyscribe.app). The app hashes a random
 * nonce into the request and sends the raw nonce here, so a token captured
 * from another app or replayed later does not verify.
 */

export class IdentityTokenError extends Error {}

export function googleAudiences(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.GOOGLE_IOS_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID, env.GOOGLE_CLIENT_ID]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function appleAudiences(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.APPLE_BUNDLE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return configured.length ? configured : ["com.studyscribe.app"];
}

type GoogleVerifier = (idToken: string, audience: string[]) => Promise<Record<string, unknown> | undefined>;

const defaultGoogleVerifier: GoogleVerifier = async (idToken, audience) => {
  const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience });
  return ticket.getPayload() as Record<string, unknown> | undefined;
};

export async function verifyGoogleIdToken(idToken: string, verify: GoogleVerifier = defaultGoogleVerifier, env = process.env): Promise<NativeIdentity> {
  const audience = googleAudiences(env);
  if (!audience.length) throw new IdentityTokenError("Google sign-in is not configured.");
  let payload: Record<string, unknown> | undefined;
  try {
    payload = await verify(idToken, audience);
  } catch {
    throw new IdentityTokenError("Google sign-in could not be verified. Please try again.");
  }
  if (!payload || typeof payload.sub !== "string") throw new IdentityTokenError("Google sign-in could not be verified. Please try again.");
  return {
    provider: "google",
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: typeof payload.name === "string" ? payload.name : null,
    ...(typeof payload.hd === "string" ? { hostedDomain: payload.hd } : {}),
  };
}

let appleKeys: JWTVerifyGetKey | null = null;
function appleJwks() {
  appleKeys ??= createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  return appleKeys;
}

export function hashNonce(rawNonce: string) {
  return createHash("sha256").update(rawNonce).digest("hex");
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  input: { rawNonce?: string | null; fullName?: string | null },
  keys: JWTVerifyGetKey = appleJwks(),
  env = process.env,
): Promise<NativeIdentity> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(identityToken, keys, { issuer: "https://appleid.apple.com", audience: appleAudiences(env) }));
  } catch {
    throw new IdentityTokenError("Apple sign-in could not be verified. Please try again.");
  }
  if (typeof payload.sub !== "string") throw new IdentityTokenError("Apple sign-in could not be verified. Please try again.");
  if (typeof payload.nonce === "string") {
    if (!input.rawNonce || hashNonce(input.rawNonce) !== payload.nonce) {
      throw new IdentityTokenError("Apple sign-in could not be verified. Please try again.");
    }
  } else if (input.rawNonce) {
    throw new IdentityTokenError("Apple sign-in could not be verified. Please try again.");
  }
  const name = input.fullName?.trim().slice(0, 200) || null;
  return {
    provider: "apple",
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    // Apple sends the name to the app once, on the first sign-in, never in the token.
    name,
  };
}
