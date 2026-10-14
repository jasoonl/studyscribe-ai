import { timingSafeEqual } from "node:crypto";

/**
 * The secret behind session cookies and every signed token (OAuth state,
 * email links, audio links). Local development falls back to a fixed value;
 * production refuses to run without JWT_SECRET, because a known fallback would
 * let anyone mint a session for any account.
 */
const DEV_FALLBACK = "default-dev-secret-change-in-production";

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set in production.");
  return DEV_FALLBACK;
}

/** Constant-time string comparison for tokens and secrets; false for different lengths or non-strings. */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
