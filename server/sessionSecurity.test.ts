import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { getJwtSecret, safeEqual } from "./_core/secrets";
import { createSessionToken, passwordFingerprint, sessionMatchesUser, verifySessionToken } from "./sessionManager";

describe("JWT secret", () => {
  it("refuses to run production without one", () => {
    expect(() => getJwtSecret({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(getJwtSecret({ NODE_ENV: "production", JWT_SECRET: " s3cret " } as NodeJS.ProcessEnv)).toBe("s3cret");
    expect(getJwtSecret({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toMatch(/dev/);
  });
});

describe("safeEqual", () => {
  it("compares in constant time and refuses empties and non-strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("abc", null)).toBe(false);
  });
});

describe("session tokens", () => {
  it("carry no password hash, only a fingerprint of it", () => {
    const token = createSessionToken({ userId: 1, email: "a@b.c", role: "user", passwordHash: "$2b$10$secretsecret" });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(JSON.stringify(decoded)).not.toContain("secretsecret");
    expect(decoded.pv).toBe(passwordFingerprint("$2b$10$secretsecret"));
  });

  it("stop working once the password changes", () => {
    const session = verifySessionToken(createSessionToken({ userId: 1, email: "a@b.c", role: "user", passwordHash: "old-hash" }))!;
    expect(sessionMatchesUser(session, { passwordHash: "old-hash" })).toBe(true);
    expect(sessionMatchesUser(session, { passwordHash: "new-hash" })).toBe(false);
    // A Google-only account that later sets a password also signs out older sessions.
    const google = verifySessionToken(createSessionToken({ userId: 2, email: "g@b.c", role: "user", passwordHash: null }))!;
    expect(sessionMatchesUser(google, { passwordHash: null })).toBe(true);
    expect(sessionMatchesUser(google, { passwordHash: "set-later" })).toBe(false);
  });

  it("keeps sessions from before fingerprints valid", () => {
    const legacy = verifySessionToken(jwt.sign({ userId: 3, email: "l@b.c", role: "user" }, getJwtSecret()))!;
    expect(legacy).not.toBeNull();
    expect(sessionMatchesUser(legacy, { passwordHash: "anything" })).toBe(true);
  });

  it("are not confused with other tokens signed with the same secret", () => {
    const oauthState = jwt.sign({ userId: 1, provider: "notion", origin: "https://x", nonce: "n" }, getJwtSecret());
    expect(verifySessionToken(oauthState)).toBeNull();
    const verifyEmail = jwt.sign({ uid: 1, email: "a@b.c", purpose: "verify-email" }, getJwtSecret());
    expect(verifySessionToken(verifyEmail)).toBeNull();
    const elevated = jwt.sign({ userId: 1, email: "a@b.c", role: "superuser" }, getJwtSecret());
    expect(verifySessionToken(elevated)).toBeNull();
    const unsigned = jwt.sign({ userId: 1, email: "a@b.c", role: "admin" }, "", { algorithm: "none" as never });
    expect(verifySessionToken(unsigned)).toBeNull();
  });
});
