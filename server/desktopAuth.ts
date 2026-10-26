import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { getJwtSecret } from "./_core/secrets";
import { authLimiter } from "./_core/rateLimit";
import { createSessionToken, setSessionCookie } from "./sessionManager";
import { getGoogleAuthUrl, isGoogleOAuthConfigured } from "./googleOAuthHandler";
import { readOAuthState, safeNextPath } from "./googleSignup";

/**
 * Google sign-in for the desktop app (E7) in the person's own browser, where
 * their Google accounts are already signed in, instead of a blank sign-in
 * page inside the app window.
 *
 * 1. The app makes a random verifier and sends only its SHA-256 (the
 *    challenge) with the state of the sign-in the page asked for to
 *    GET /api/auth/google/desktop, which re-signs that state with the
 *    challenge and returns Google's URL. The app opens it in the browser.
 * 2. The Google callback sees the challenge in the state and, instead of
 *    setting a cookie in the browser, shows a page that opens
 *    studyscribe://signed-in?code=<handoff> (`desktopHandoffPage`).
 * 3. The app posts the code and its verifier from its own page to
 *    POST /api/auth/desktop/exchange, which sets the session cookie there.
 *
 * The handoff code is signed and expires after five minutes, and it is
 * useless without the verifier, which never leaves the app, so another
 * program that catches the studyscribe:// link cannot sign in with it.
 */

const HANDOFF_TTL_SECONDS = 5 * 60;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function desktopChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isDesktopChallenge(value: unknown): value is string {
  return typeof value === "string" && CHALLENGE.test(value);
}

type Handoff = { typ: "desktop-handoff"; userId: number; challenge: string; next?: string; exp: number };

export function signDesktopHandoff(
  data: { userId: number; challenge: string; next?: string },
  secret = getJwtSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const payload: Handoff = { typ: "desktop-handoff", ...data, exp: nowSeconds + HANDOFF_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** The account and landing path for a handoff code, or null when it was edited, expired, or the verifier does not match. */
export function readDesktopHandoff(
  code: unknown,
  verifier: unknown,
  secret = getJwtSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
): { userId: number; next?: string } | null {
  if (typeof code !== "string" || code.length > 2048 || typeof verifier !== "string" || verifier.length < 32 || verifier.length > 128) return null;
  const [body, signature, extra] = code.split(".");
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
  if (!data || data.typ !== "desktop-handoff" || !Number.isInteger(data.userId) || typeof data.exp !== "number" || data.exp < nowSeconds) return null;
  const challenge = Buffer.from(desktopChallenge(verifier));
  const stored = Buffer.from(String(data.challenge ?? ""));
  if (challenge.length !== stored.length || !timingSafeEqual(challenge, stored)) return null;
  return { userId: data.userId, next: safeNextPath(data.next) ?? undefined };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** What the browser shows after a desktop sign-in: it opens the app, with a button in case the browser asks first. */
export function desktopHandoffPage(code: string) {
  const link = escapeHtml(`studyscribe://signed-in?code=${encodeURIComponent(code)}`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${link}">
<title>Back to StudyScribe</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafd; color: #0f172a; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 380px; padding: 32px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #475569; margin: 0 0 24px; }
  a { display: inline-block; padding: 10px 20px; border-radius: 999px; background: #2f54d8; color: #fff; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>You're signed in</h1>
  <p>Go back to the StudyScribe app to carry on. You can close this tab.</p>
  <a href="${link}">Open StudyScribe</a>
</main>
</body>
</html>`;
}

export function registerDesktopAuthRoutes(app: Express) {
  /**
   * GET /api/auth/google/desktop?state=…&challenge=…
   * Re-signs the state of a sign-in the app's page started with the app's challenge.
   */
  app.get("/api/auth/google/desktop", authLimiter, (req: Request, res: Response) => {
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({ error: "Google OAuth is not configured" });
      return;
    }
    const state = readOAuthState(typeof req.query.state === "string" ? req.query.state : "");
    const challenge = req.query.challenge;
    if (!state || !isDesktopChallenge(challenge)) {
      res.status(400).json({ error: "That sign-in link expired or was changed. Please try again." });
      return;
    }
    const authUrl = getGoogleAuthUrl(state.origin, state.mode, undefined, state.consented === true, state.invite, state.next, challenge);
    res.json({ authUrl });
  });

  /**
   * POST /api/auth/desktop/exchange { code, verifier }
   * Called by the app's own page; sets the session cookie in the app.
   */
  app.post("/api/auth/desktop/exchange", authLimiter, async (req: Request, res: Response) => {
    try {
      const handoff = readDesktopHandoff(req.body?.code, req.body?.verifier);
      if (!handoff) {
        res.status(400).json({ error: "That sign-in expired. Please try again." });
        return;
      }
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [user] = await db.select().from(users).where(eq(users.id, handoff.userId)).limit(1);
      if (!user) {
        res.status(400).json({ error: "That sign-in expired. Please try again." });
        return;
      }
      setSessionCookie(res, createSessionToken({ userId: user.id, email: user.email, role: user.role, passwordHash: user.passwordHash }));
      res.json({ success: true, next: handoff.next ?? "/dashboard" });
    } catch (error) {
      console.error("[Auth] Desktop sign-in exchange failed", error);
      res.status(500).json({ error: "Sign-in failed. Please try again." });
    }
  });
}
