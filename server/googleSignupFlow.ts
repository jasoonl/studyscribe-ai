import type { User } from "../drizzle/schema";
import { getInviteCodeByCode } from "./db";
import { createGoogleUser, findGoogleAccount, type GoogleUser } from "./googleOAuthHandler";
import { claimInviteCode, decideGoogleSignup, recordInviteUser, releaseInviteCode } from "./googleSignup";
import { countRecentSignups, isOpenSignupEnabled, openSignupDailyCap } from "./openSignup";
import { checkTrpcRateLimit } from "./_core/rateLimit";

export type GoogleSignupDeps = {
  findAccount: (googleUser: GoogleUser) => Promise<User | null>;
  createAccount: (googleUser: GoogleUser) => Promise<User | undefined>;
  getInvite: (code: string) => Promise<{ code: string; email: string; isUsed: number; expiresAt: Date } | null>;
  claimInvite: (code: string) => Promise<boolean>;
  releaseInvite: (code: string) => Promise<void>;
  recordInviteUser: (code: string, userId: number) => Promise<void>;
  openSignup: () => Promise<boolean>;
  recentSignups: () => Promise<number>;
  dailyCap: () => number;
  domainOrg: (email: string, hostedDomain?: string) => Promise<{ id: number } | null>;
  joinOrg: (orgId: number, userId: number) => Promise<unknown>;
  allowFromNetwork: (ip: string) => boolean;
};

const defaultDeps: GoogleSignupDeps = {
  findAccount: findGoogleAccount,
  createAccount: createGoogleUser,
  getInvite: getInviteCodeByCode,
  claimInvite: (code) => claimInviteCode(code),
  releaseInvite: releaseInviteCode,
  recordInviteUser,
  openSignup: isOpenSignupEnabled,
  recentSignups: () => countRecentSignups(),
  dailyCap: () => openSignupDailyCap(),
  // Teams with a verified domain (F3) plug in here.
  domainOrg: async () => null,
  joinOrg: async () => undefined,
  // Same brake as email sign-up's signupLimiter: five new accounts per network per hour.
  allowFromNetwork: (ip) => checkTrpcRateLimit(`google-signup:${ip}`, 60 * 60 * 1000, 5),
};

/**
 * Google sign-up after the OAuth callback. An existing account just signs in.
 * Otherwise the same rules as email sign-up decide (`decideGoogleSignup`): a
 * valid invite for this address, claimed in one conditional update so it
 * cannot be used twice and given back if creating the account fails; a team's
 * verified domain with auto-join; or open sign-up within the same per-network
 * and daily limits. Accounts from open sign-up start on the Free plan like
 * any account without a subscription.
 */
export async function completeGoogleSignup(
  googleUser: GoogleUser,
  inviteCode: string | undefined,
  ip: string,
  deps: GoogleSignupDeps = defaultDeps,
): Promise<{ user: User; created: boolean } | { error: string }> {
  const existing = await deps.findAccount(googleUser);
  if (existing) return { user: existing, created: false };

  if (!googleUser.email) return { error: "Google did not share an email address for this account." };
  const invite = inviteCode ? await deps.getInvite(inviteCode) : null;
  const domainOrg = inviteCode ? null : await deps.domainOrg(googleUser.email, googleUser.hostedDomain);
  const openSignup = inviteCode || domainOrg ? false : await deps.openSignup();
  const decision = decideGoogleSignup({
    existingAccount: false,
    email: googleUser.email,
    inviteCode: inviteCode ?? null,
    invite,
    openSignup,
    recentSignups: openSignup ? await deps.recentSignups() : 0,
    dailyCap: deps.dailyCap(),
    domainJoin: Boolean(domainOrg),
  });
  if (decision.path === "closed") return { error: decision.reason };
  if (decision.path === "login") return { error: "Sign in instead." };

  if (decision.path === "open" && !deps.allowFromNetwork(ip)) {
    return { error: "Too many accounts created from this network. Try again in an hour." };
  }

  if (decision.path === "invite") {
    const code = inviteCode!;
    if (!(await deps.claimInvite(code))) return { error: "That invite code has already been used." };
    let user: User | undefined;
    try {
      user = await deps.createAccount(googleUser);
    } catch (error) {
      await deps.releaseInvite(code);
      throw error;
    }
    if (!user) {
      await deps.releaseInvite(code);
      return { error: "Could not create the account. Please try again." };
    }
    await deps.recordInviteUser(code, user.id);
    return { user, created: true };
  }

  const user = await deps.createAccount(googleUser);
  if (!user) return { error: "Could not create the account. Please try again." };
  if (decision.path === "domain" && domainOrg) {
    try {
      await deps.joinOrg(domainOrg.id, user.id);
    } catch (error) {
      console.error("[Auth] Could not add the new account to its team:", error instanceof Error ? error.message : error);
    }
  }
  return { user, created: true };
}
