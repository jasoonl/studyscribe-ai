import rateLimit, { type RateLimitExceededEventHandler } from "express-rate-limit";

/**
 * In-memory, per-instance limits — Vercel's serverless functions don't share
 * state across instances, so this doesn't guarantee a global cap under high
 * concurrency. It still meaningfully raises the cost of credential stuffing,
 * signup abuse, and email-bombing from any single warm instance, which is
 * the realistic threat model here (no dedicated abuse-detection service).
 */

const jsonRateLimitHandler: RateLimitExceededEventHandler = (_req, res) => {
  res.status(429).json({ error: "Too many requests. Please try again later." });
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

/**
 * Plain fixed-window counter for tRPC procedures, which don't sit behind
 * Express route middleware the way the REST auth routes above do. Same
 * per-instance caveat as the limiters above.
 */
const trpcWindows = new Map<string, { count: number; resetAt: number }>();

export function checkTrpcRateLimit(key: string, windowMs: number, limit: number): boolean {
  const now = Date.now();
  const entry = trpcWindows.get(key);
  if (!entry || now >= entry.resetAt) {
    trpcWindows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}
