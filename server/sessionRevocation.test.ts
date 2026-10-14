import { describe, expect, it } from "vitest";
import { isRevokedBy } from "./sessionRevocation";
import { createSessionToken, verifySessionToken } from "./sessionManager";

process.env.JWT_SECRET ||= "test-secret";

describe("isRevokedBy", () => {
  const session = { sid: "abc", iat: 1_000 };
  it("revokes one session by id", () => {
    expect(isRevokedBy([{ sid: "abc", cutoffAt: null }], session)).toBe(true);
    expect(isRevokedBy([{ sid: "other", cutoffAt: null }], session)).toBe(false);
  });
  it("revokes sessions made before a sign-out-everywhere cutoff, not after", () => {
    expect(isRevokedBy([{ sid: null, cutoffAt: new Date(1_001_000) }], session)).toBe(true);
    expect(isRevokedBy([{ sid: null, cutoffAt: new Date(1_000_000) }], session)).toBe(false);
    expect(isRevokedBy([{ sid: null, cutoffAt: new Date(999_000) }], session)).toBe(false);
  });
  it("covers sessions from before session ids with a cutoff, never with a single revocation", () => {
    expect(isRevokedBy([{ sid: null, cutoffAt: new Date(2_000_000) }], { iat: 1_000 })).toBe(true);
    expect(isRevokedBy([{ sid: "abc", cutoffAt: null }], { iat: 1_000 })).toBe(false);
  });
});

describe("session tokens", () => {
  it("carry a distinct session id each time", () => {
    const make = () => verifySessionToken(createSessionToken({ userId: 1, email: "a@b.c", role: "user", passwordHash: "x" }));
    const a = make();
    const b = make();
    expect(a?.sid).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a?.sid).not.toBe(b?.sid);
  });
});
