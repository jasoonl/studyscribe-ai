import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { inviteCodes } from "../drizzle/schema";
import { getDb, normalizeAuthEmail } from "./db";

/**
 * Google sign-up rules.
 *
 * The OAuth `state` round-trips through Google and the browser, so anything
 * the callback trusts (the mode, the age and Terms confirmations, the invite
 * code) is signed here with HMAC-SHA256 under JWT_SECRET and expires after
 * fifteen minutes. A state that was edited, forged or replayed late is
 * refused rather than read.
 *
 * Who may create an account is decided by `decideGoogleSignup`, which mirrors
 * the email sign-up rule (`decideSignupPath` plus `registerWithEmailPassword`):
 * an existing account just signs in; otherwise an invite is required unless
 * open sign-up is on (then the same daily cap applies) or the address belongs
 * to a team's verified domain with auto-join (F3).
 */

const STATE_TTL_SECONDS = 15 * 60;

export type GoogleOAuthState = {
  origin: string;
  mode: "login" | "signup";
  consented?: boolean;
  /** Invite code typed into (or linked to) the sign-up page. */
  invite?: string;
  /** Unix seconds after which the state is refused. */
  exp: number;
  /** Random, so two states are never equal. */
  n: string;
};

function stateSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.JWT_SECRET || "default-dev-secret-change-in-production";
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function signOAuthState(
  data: Omit<GoogleOAuthState, "exp" | "n">,
  secret = stateSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: GoogleOAuthState = { ...data, exp: nowSeconds + STATE_TTL_SECONDS, n: randomBytes(9).toString("base64url") };
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readOAuthState(state: string, secret = stateSecret(), nowSeconds = Math.floor(Date.now() / 1000)): GoogleOAuthState | null {
  if (typeof state !== "string" || state.length > 4096) return null;
  const [body, signature, extra] = state.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data: any;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || (data.mode !== "login" && data.mode !== "signup") || typeof data.origin !== "string") return null;
  if (typeof data.exp !== "number" || data.exp < nowSeconds) return null;
  return {
    origin: data.origin,
    mode: data.mode,
    consented: data.consented === true,
    invite: typeof data.invite === "string" && data.invite.trim() ? data.invite.trim().slice(0, 64) : undefined,
    exp: data.exp,
    n: String(data.n ?? ""),
  };
}

type InviteRow = { email: string; isUsed: number; expiresAt: Date };

export type GoogleSignupDecision =
  | { path: "login" }
  | { path: "invite" }
  | { path: "open" }
  | { path: "domain" }
  | { path: "closed"; reason: string };

/** "j***@school.edu": enough for the person to recognise the address without showing it whole. */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "another address";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function decideGoogleSignup(input: {
  existingAccount: boolean;
  email: string;
  inviteCode?: string | null;
  invite?: InviteRow | null;
  openSignup: boolean;
  recentSignups: number;
  dailyCap: number;
  /** The address is on a team's verified domain that lets people join on their own. */
  domainJoin?: boolean;
  now?: Date;
}): GoogleSignupDecision {
  if (input.existingAccount) return { path: "login" };
  const now = input.now ?? new Date();
  if (input.inviteCode) {
    const invite = input.invite;
    if (!invite) return { path: "closed", reason: "That invite code is not valid." };
    if (invite.isUsed) return { path: "closed", reason: "That invite code has already been used." };
    if (now > invite.expiresAt) return { path: "closed", reason: "That invite code has expired. Ask for a new one." };
    // Same rule as email sign-up: the invite belongs to one address.
    if (normalizeAuthEmail(invite.email) !== normalizeAuthEmail(input.email)) {
      return { path: "closed", reason: `This invite is for ${maskEmail(normalizeAuthEmail(invite.email))}. Continue with the Google account for that address, or ask for a new invite.` };
    }
    return { path: "invite" };
  }
  if (input.domainJoin) return { path: "domain" };
  if (!input.openSignup) return { path: "closed", reason: "An invite is required to sign up. Open your invite link, then continue with Google." };
  if (input.recentSignups >= input.dailyCap) {
    return { path: "closed", reason: "Sign-ups are paused for today because of unusually high demand. Try again tomorrow, or ask for an invite." };
  }
  return { path: "open" };
}

/**
 * Marks an invite used before the account is created, in one conditional
 * update, so two sign-ups racing with the same code cannot both pass.
 * Returns false when the code was already used or has expired meanwhile.
 */
export async function claimInviteCode(code: string, now = new Date()) {
  const db = await getDb();
  if (!db) return false;
  const result: any = await db
    .update(inviteCodes)
    .set({ isUsed: 1, usedAt: now })
    .where(and(eq(inviteCodes.code, code), eq(inviteCodes.isUsed, 0), gt(inviteCodes.expiresAt, now)));
  const affected = Array.isArray(result) ? result[0]?.affectedRows : result?.affectedRows;
  return affected === 1;
}

/** Gives a claimed invite back when creating the account failed after the claim. */
export async function releaseInviteCode(code: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(inviteCodes).set({ isUsed: 0, usedAt: null, usedBy: null }).where(eq(inviteCodes.code, code));
}

export async function recordInviteUser(code: string, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(inviteCodes).set({ usedBy: userId }).where(eq(inviteCodes.code, code));
}
