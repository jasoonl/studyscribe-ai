import { describe, expect, it, vi } from "vitest";
import { decideGoogleSignup, maskEmail, readOAuthState, signOAuthState } from "./googleSignup";
import { completeGoogleSignup, type GoogleSignupDeps } from "./googleSignupFlow";

const SECRET = "test-secret";
const NOW = 1_800_000_000;

describe("signed Google OAuth state", () => {
  it("round-trips the mode, consent and invite", () => {
    const state = signOAuthState({ origin: "https://app.example", mode: "signup", consented: true, invite: "abc123" }, SECRET, NOW);
    expect(readOAuthState(state, SECRET, NOW + 60)).toMatchObject({ origin: "https://app.example", mode: "signup", consented: true, invite: "abc123" });
  });

  it("refuses a state that was edited, signed with another secret, or expired", () => {
    const state = signOAuthState({ origin: "https://app.example", mode: "signup", consented: true }, SECRET, NOW);
    const [body, signature] = state.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), invite: "stolen" })).toString("base64url");
    expect(readOAuthState(`${forgedBody}.${signature}`, SECRET, NOW)).toBeNull();
    expect(readOAuthState(state, "other-secret", NOW)).toBeNull();
    expect(readOAuthState(state, SECRET, NOW + 16 * 60)).toBeNull();
    // The old unsigned base64 JSON state is no longer accepted.
    expect(readOAuthState(Buffer.from(JSON.stringify({ origin: "https://app.example", mode: "signup", consented: true })).toString("base64"), SECRET, NOW)).toBeNull();
  });
});

describe("decideGoogleSignup", () => {
  const base = { existingAccount: false, email: "ana@school.edu", openSignup: false, recentSignups: 0, dailyCap: 200, now: new Date("2026-10-13T12:00:00Z") };
  const invite = { email: "Ana@School.edu", isUsed: 0, expiresAt: new Date("2026-10-20T00:00:00Z") };

  it("lets an existing account sign in whatever else is true", () => {
    expect(decideGoogleSignup({ ...base, existingAccount: true })).toEqual({ path: "login" });
  });

  it("needs an invite while open sign-up is off", () => {
    expect(decideGoogleSignup(base)).toMatchObject({ path: "closed" });
  });

  it("accepts a valid invite for the same address, ignoring case", () => {
    expect(decideGoogleSignup({ ...base, inviteCode: "code", invite })).toEqual({ path: "invite" });
  });

  it("refuses an invite for another address, as email sign-up does", () => {
    const decision = decideGoogleSignup({ ...base, email: "someone@gmail.com", inviteCode: "code", invite });
    expect(decision).toMatchObject({ path: "closed" });
    expect(decision.path === "closed" && decision.reason).toContain("a***@school.edu");
  });

  it("refuses unknown, used and expired invites even when open sign-up is on", () => {
    expect(decideGoogleSignup({ ...base, openSignup: true, inviteCode: "nope", invite: null })).toMatchObject({ path: "closed" });
    expect(decideGoogleSignup({ ...base, inviteCode: "code", invite: { ...invite, isUsed: 1 } })).toMatchObject({ path: "closed" });
    expect(decideGoogleSignup({ ...base, inviteCode: "code", invite: { ...invite, expiresAt: new Date("2026-10-01T00:00:00Z") } })).toMatchObject({ path: "closed" });
  });

  it("follows open sign-up and its daily cap", () => {
    expect(decideGoogleSignup({ ...base, openSignup: true })).toEqual({ path: "open" });
    expect(decideGoogleSignup({ ...base, openSignup: true, recentSignups: 200 })).toMatchObject({ path: "closed" });
  });

  it("lets a team's verified domain admit people without an invite", () => {
    expect(decideGoogleSignup({ ...base, domainJoin: true })).toEqual({ path: "domain" });
  });

  it("masks addresses", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
  });
});

describe("completeGoogleSignup", () => {
  const googleUser = { id: "g-1", email: "ana@school.edu", name: "Ana" };
  const newUser = { id: 42, email: "ana@school.edu" } as any;

  function deps(overrides: Partial<GoogleSignupDeps> = {}): GoogleSignupDeps {
    return {
      findAccount: vi.fn(async () => null),
      createAccount: vi.fn(async () => newUser),
      getInvite: vi.fn(async (code: string) => ({ code, email: "ana@school.edu", isUsed: 0, expiresAt: new Date(Date.now() + 86_400_000) })),
      claimInvite: vi.fn(async () => true),
      releaseInvite: vi.fn(async () => undefined),
      recordInviteUser: vi.fn(async () => undefined),
      openSignup: vi.fn(async () => false),
      recentSignups: vi.fn(async () => 0),
      dailyCap: () => 200,
      domainOrg: vi.fn(async () => null),
      joinOrg: vi.fn(async () => undefined),
      allowFromNetwork: vi.fn(() => true),
      ...overrides,
    };
  }

  it("signs an existing account in without touching the invite", async () => {
    const d = deps({ findAccount: vi.fn(async () => ({ id: 7 }) as any) });
    expect(await completeGoogleSignup(googleUser, "code", "1.1.1.1", d)).toMatchObject({ user: { id: 7 }, created: false });
    expect(d.claimInvite).not.toHaveBeenCalled();
    expect(d.createAccount).not.toHaveBeenCalled();
  });

  it("refuses to create an account without an invite while sign-up is closed", async () => {
    const d = deps();
    expect(await completeGoogleSignup(googleUser, undefined, "1.1.1.1", d)).toHaveProperty("error");
    expect(d.createAccount).not.toHaveBeenCalled();
  });

  it("claims the invite, creates the account and records who used it", async () => {
    const d = deps();
    expect(await completeGoogleSignup(googleUser, "code", "1.1.1.1", d)).toMatchObject({ user: { id: 42 }, created: true });
    expect(d.claimInvite).toHaveBeenCalledWith("code");
    expect(d.recordInviteUser).toHaveBeenCalledWith("code", 42);
  });

  it("stops when another sign-up claimed the invite first", async () => {
    const d = deps({ claimInvite: vi.fn(async () => false) });
    expect(await completeGoogleSignup(googleUser, "code", "1.1.1.1", d)).toHaveProperty("error");
    expect(d.createAccount).not.toHaveBeenCalled();
  });

  it("gives the invite back when creating the account fails", async () => {
    const d = deps({ createAccount: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(completeGoogleSignup(googleUser, "code", "1.1.1.1", d)).rejects.toThrow("db down");
    expect(d.releaseInvite).toHaveBeenCalledWith("code");
  });

  it("applies the per-network limit to open sign-ups", async () => {
    const d = deps({ openSignup: vi.fn(async () => true), allowFromNetwork: vi.fn(() => false) });
    expect(await completeGoogleSignup(googleUser, undefined, "1.1.1.1", d)).toHaveProperty("error");
    expect(d.createAccount).not.toHaveBeenCalled();
  });

  it("creates a Free account through open sign-up", async () => {
    const d = deps({ openSignup: vi.fn(async () => true) });
    expect(await completeGoogleSignup(googleUser, undefined, "1.1.1.1", d)).toMatchObject({ created: true });
    expect(d.claimInvite).not.toHaveBeenCalled();
  });

  it("adds people from a team's verified domain to that team", async () => {
    const d = deps({ domainOrg: vi.fn(async () => ({ id: 5 })) });
    expect(await completeGoogleSignup(googleUser, undefined, "1.1.1.1", d)).toMatchObject({ created: true });
    expect(d.joinOrg).toHaveBeenCalledWith(5, 42);
  });
});
