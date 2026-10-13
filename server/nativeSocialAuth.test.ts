import { describe, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";
import { completeNativeSocialAuth, decideNativeSignup, type NativeAuthDeps, type NativeIdentity } from "./nativeSocialAuth";

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);
const user = (id: number, email: string) => ({ id, email, name: "Ada", role: "user" }) as unknown as User;
const google: NativeIdentity = { provider: "google", subject: "g-1", email: "ada@example.com", emailVerified: true, name: "Ada" };
const apple: NativeIdentity = { provider: "apple", subject: "a-1", email: "ada@example.com", emailVerified: true, name: null };

function deps(overrides: Partial<NativeAuthDeps> = {}): NativeAuthDeps {
  return {
    findByProvider: vi.fn(async () => null),
    findByEmail: vi.fn(async () => null),
    link: vi.fn(async () => undefined),
    touch: vi.fn(async () => undefined),
    create: vi.fn(async (identity: NativeIdentity) => user(42, identity.email!)),
    getInvite: vi.fn(async () => ({ code: "INV", email: "ada@example.com", isUsed: 0, expiresAt: future })),
    claimInvite: vi.fn(async () => true),
    releaseInvite: vi.fn(async () => undefined),
    recordInviteUser: vi.fn(async () => undefined),
    openSignup: vi.fn(async () => false),
    recentSignups: vi.fn(async () => 0),
    dailyCap: () => 200,
    allowFromNetwork: () => true,
    ...overrides,
  };
}

describe("decideNativeSignup", () => {
  const base = { email: "ada@example.com", openSignup: false, recentSignups: 0, dailyCap: 10 };
  it("accepts a valid invite for the same address, ignoring case", () => {
    expect(decideNativeSignup({ ...base, email: "ADA@example.com", inviteCode: "INV", invite: { code: "INV", email: "ada@example.com", isUsed: 0, expiresAt: future } })).toEqual({ path: "invite" });
  });
  it("refuses used, expired, unknown and mismatched invites", () => {
    expect(decideNativeSignup({ ...base, inviteCode: "INV", invite: null }).path).toBe("closed");
    expect(decideNativeSignup({ ...base, inviteCode: "INV", invite: { code: "INV", email: "ada@example.com", isUsed: 1, expiresAt: future } }).path).toBe("closed");
    expect(decideNativeSignup({ ...base, inviteCode: "INV", invite: { code: "INV", email: "ada@example.com", isUsed: 0, expiresAt: past } }).path).toBe("closed");
    expect(decideNativeSignup({ ...base, inviteCode: "INV", invite: { code: "INV", email: "bob@example.com", isUsed: 0, expiresAt: future } }).path).toBe("closed");
  });
  it("needs an invite unless open sign-up is on and under its cap", () => {
    expect(decideNativeSignup(base)).toMatchObject({ path: "closed", reason: "An invite code is required to sign up." });
    expect(decideNativeSignup({ ...base, openSignup: true })).toEqual({ path: "open" });
    expect(decideNativeSignup({ ...base, openSignup: true, recentSignups: 10 }).path).toBe("closed");
  });
  it("needs an email address", () => {
    expect(decideNativeSignup({ ...base, email: null, openSignup: true }).path).toBe("closed");
  });
});

describe("completeNativeSocialAuth", () => {
  it("signs in an account already linked to the provider", async () => {
    const d = deps({ findByProvider: vi.fn(async () => user(5, "ada@example.com")) });
    const result = await completeNativeSocialAuth(google, { mode: "login", ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ user: { id: 5 }, created: false });
    expect(d.touch).toHaveBeenCalled();
    expect(d.create).not.toHaveBeenCalled();
  });

  it("links an existing account by verified email on login", async () => {
    const d = deps({ findByEmail: vi.fn(async () => user(6, "ada@example.com")) });
    const result = await completeNativeSocialAuth(apple, { mode: "login", ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ user: { id: 6 }, created: false });
    expect(d.link).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }), apple);
  });

  it("does not match an account by an unverified email", async () => {
    const d = deps({ findByEmail: vi.fn(async () => user(6, "ada@example.com")) });
    const result = await completeNativeSocialAuth({ ...google, emailVerified: false }, { mode: "login", ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 401 });
    expect(d.findByEmail).not.toHaveBeenCalled();
  });

  it("never creates an account from the login screen", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(google, { mode: "login", ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 401 });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("requires the age and Terms confirmations to sign up", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(google, { mode: "signup", inviteCode: "INV", consented: false, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 400 });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("creates an account with a valid invite and records who used it", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(google, { mode: "signup", inviteCode: "INV", consented: true, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ user: { id: 42 }, created: true });
    expect(d.claimInvite).toHaveBeenCalledWith("INV");
    expect(d.recordInviteUser).toHaveBeenCalledWith("INV", 42);
  });

  it("gives the invite back when creating the account fails", async () => {
    const d = deps({ create: vi.fn(async () => null) });
    const result = await completeNativeSocialAuth(google, { mode: "signup", inviteCode: "INV", consented: true, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 500 });
    expect(d.releaseInvite).toHaveBeenCalledWith("INV");
  });

  it("refuses an invite another sign-up claimed first", async () => {
    const d = deps({ claimInvite: vi.fn(async () => false) });
    const result = await completeNativeSocialAuth(google, { mode: "signup", inviteCode: "INV", consented: true, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 400 });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses sign-up without an invite while open sign-up is off", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(google, { mode: "signup", consented: true, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 400, error: "An invite code is required to sign up." });
  });

  it("applies the per-network limit to open sign-up", async () => {
    const d = deps({ openSignup: vi.fn(async () => true), allowFromNetwork: () => false });
    const result = await completeNativeSocialAuth(google, { mode: "signup", consented: true, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 429 });
  });

  it("just signs in when a sign-up finds an existing account", async () => {
    const d = deps({ findByProvider: vi.fn(async () => user(9, "ada@example.com")) });
    const result = await completeNativeSocialAuth(google, { mode: "signup", consented: false, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ user: { id: 9 }, created: false });
  });
});
