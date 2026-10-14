import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { IdentityTokenError, appleAudiences, googleAudiences, hashNonce, verifyAppleIdentityToken, verifyGoogleIdToken } from "./nativeIdentity";

async function appleKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
  return { keys: createLocalJWKSet({ keys: [jwk] }), privateKey };
}

async function appleToken(privateKey: CryptoKey, claims: Record<string, unknown>, options: { audience?: string; issuer?: string; expires?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(options.issuer ?? "https://appleid.apple.com")
    .setAudience(options.audience ?? "com.studyscribe.app")
    .setSubject("apple-sub-1")
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "10m")
    .sign(privateKey);
}

describe("Apple identity tokens", () => {
  it("verifies a token for our bundle id with the matching nonce", async () => {
    const { keys, privateKey } = await appleKeys();
    const token = await appleToken(privateKey, { email: "ada@privaterelay.appleid.com", email_verified: "true", nonce: hashNonce("raw-nonce") });
    const identity = await verifyAppleIdentityToken(token, { rawNonce: "raw-nonce", fullName: " Ada Lovelace " }, keys, {} as NodeJS.ProcessEnv);
    expect(identity).toEqual({ provider: "apple", subject: "apple-sub-1", email: "ada@privaterelay.appleid.com", emailVerified: true, name: "Ada Lovelace" });
  });

  it("refuses a wrong nonce, a missing nonce, another audience, another issuer and an expired token", async () => {
    const { keys, privateKey } = await appleKeys();
    const env = {} as NodeJS.ProcessEnv;
    const withNonce = await appleToken(privateKey, { nonce: hashNonce("raw-nonce") });
    await expect(verifyAppleIdentityToken(withNonce, { rawNonce: "other" }, keys, env)).rejects.toBeInstanceOf(IdentityTokenError);
    await expect(verifyAppleIdentityToken(withNonce, {}, keys, env)).rejects.toBeInstanceOf(IdentityTokenError);
    const otherApp = await appleToken(privateKey, {}, { audience: "com.example.other" });
    await expect(verifyAppleIdentityToken(otherApp, {}, keys, env)).rejects.toBeInstanceOf(IdentityTokenError);
    const otherIssuer = await appleToken(privateKey, {}, { issuer: "https://evil.example" });
    await expect(verifyAppleIdentityToken(otherIssuer, {}, keys, env)).rejects.toBeInstanceOf(IdentityTokenError);
    const expired = await appleToken(privateKey, {}, { expires: "-1m" });
    await expect(verifyAppleIdentityToken(expired, {}, keys, env)).rejects.toBeInstanceOf(IdentityTokenError);
  });

  it("refuses a token signed with a key Apple did not publish", async () => {
    const { keys } = await appleKeys();
    const { privateKey: stranger } = await generateKeyPair("RS256");
    const token = await appleToken(stranger, {});
    await expect(verifyAppleIdentityToken(token, {}, keys, {} as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(IdentityTokenError);
  });

  it("reads bundle ids from APPLE_BUNDLE_IDS", () => {
    expect(appleAudiences({ APPLE_BUNDLE_IDS: "com.a.app, com.b.app" } as NodeJS.ProcessEnv)).toEqual(["com.a.app", "com.b.app"]);
    expect(appleAudiences({} as NodeJS.ProcessEnv)).toEqual(["com.studyscribe.app"]);
  });
});

describe("Google ID tokens", () => {
  const env = { GOOGLE_IOS_CLIENT_ID: "ios-id", GOOGLE_ANDROID_CLIENT_ID: "android-id", GOOGLE_CLIENT_ID: "web-id" } as NodeJS.ProcessEnv;

  it("accepts the iOS, Android and web client ids as audiences", () => {
    expect(googleAudiences(env)).toEqual(["ios-id", "android-id", "web-id"]);
  });

  it("maps a verified payload to an identity", async () => {
    let seenAudience: string[] = [];
    const identity = await verifyGoogleIdToken("token", async (_token, audience) => {
      seenAudience = audience;
      return { sub: "g-1", email: "ada@example.com", email_verified: true, name: "Ada" };
    }, env);
    expect(seenAudience).toEqual(["ios-id", "android-id", "web-id"]);
    expect(identity).toEqual({ provider: "google", subject: "g-1", email: "ada@example.com", emailVerified: true, name: "Ada" });
  });

  it("turns a verification failure into an explanatory error", async () => {
    await expect(verifyGoogleIdToken("token", async () => { throw new Error("Wrong recipient"); }, env)).rejects.toBeInstanceOf(IdentityTokenError);
  });

  it("is off until a client id is configured", async () => {
    await expect(verifyGoogleIdToken("token", async () => ({ sub: "x" }), {} as NodeJS.ProcessEnv)).rejects.toThrow("not configured");
  });
});
