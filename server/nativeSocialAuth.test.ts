import { describe, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";
import { completeNativeSocialAuth, type NativeAuthDeps, type NativeIdentity } from "./nativeSocialAuth";

const user = (id: number) => ({ id, email: "ada@example.com", name: "Ada", role: "user" }) as unknown as User;
const google: NativeIdentity = { provider: "google", subject: "g-1", email: "ada@example.com", emailVerified: true, name: "Ada", hostedDomain: "uni.edu" };
const apple: NativeIdentity = { provider: "apple", subject: "a-1", email: "ada@privaterelay.appleid.com", emailVerified: true, name: null };

function deps(overrides: Partial<NativeAuthDeps> = {}): NativeAuthDeps {
  return {
    findAccount: vi.fn(async () => null),
    signup: vi.fn(async () => ({ user: user(42), created: true })),
    afterSignIn: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("completeNativeSocialAuth", () => {
  it("signs in an existing account on login and runs the post-sign-in step (team auto-join)", async () => {
    const d = deps({ findAccount: vi.fn(async () => user(5)) });
    const result = await completeNativeSocialAuth(google, { mode: "login", ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ user: { id: 5 }, created: false });
    expect(d.afterSignIn).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), google);
    expect(d.signup).not.toHaveBeenCalled();
  });

  it("never creates an account from the login screen", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(apple, { mode: "login", ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 401 });
    expect(d.signup).not.toHaveBeenCalled();
  });

  it("requires the age and Terms confirmations to create an account", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(google, { mode: "signup", inviteCode: "INV", consented: false, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 400 });
    expect(d.signup).not.toHaveBeenCalled();
  });

  it("just signs in when a sign-up finds an existing account, without asking for consent again", async () => {
    const d = deps({ findAccount: vi.fn(async () => user(9)) });
    const result = await completeNativeSocialAuth(google, { mode: "signup", consented: false, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ user: { id: 9 }, created: false });
  });

  it("refuses sign-up without a verified email", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth({ ...apple, email: null }, { mode: "signup", consented: true, ip: "1.1.1.1" }, d);
    expect(result).toMatchObject({ status: 400 });
    expect(d.signup).not.toHaveBeenCalled();
  });

  it("hands the invite and network to the web's sign-up decision", async () => {
    const d = deps();
    const result = await completeNativeSocialAuth(google, { mode: "signup", inviteCode: "  INV  ", consented: true, ip: "1.1.1.1" }, d);
    expect(d.signup).toHaveBeenCalledWith(google, "INV", "1.1.1.1");
    expect(result).toMatchObject({ user: { id: 42 }, created: true });
    expect(d.afterSignIn).toHaveBeenCalled();
  });

  it("passes the decision's refusal through, with 429 for the network limit", async () => {
    const closed = deps({ signup: vi.fn(async () => ({ error: "An invite is required to sign up." })) });
    expect(await completeNativeSocialAuth(google, { mode: "signup", consented: true, ip: "1.1.1.1" }, closed)).toMatchObject({ status: 400, error: "An invite is required to sign up." });
    const limited = deps({ signup: vi.fn(async () => ({ error: "Too many accounts created from this network. Try again in an hour." })) });
    expect(await completeNativeSocialAuth(google, { mode: "signup", consented: true, ip: "1.1.1.1" }, limited)).toMatchObject({ status: 429 });
  });
});
