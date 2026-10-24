import { revokeSession, sessionIsValid } from "./sessionRevocation";
import type { Express, NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users, type User } from "../drizzle/schema";
import { getAppSetting, getDb, getRecordingByAudioKey } from "./db";
import { createSessionToken, getBearerToken, sessionMatchesUser, verifySessionToken } from "./sessionManager";
import { authLimiter } from "./_core/rateLimit";
import { streamStoredAudio } from "./_core/storageProxy";
import { TRANSFER_PAUSED_MESSAGE, isTransferLimitReached, isTransferSoftCapReached } from "./blobTransfer";
import { completeNativeSocialAuth } from "./nativeSocialAuth";
import { IdentityTokenError, verifyAppleIdentityToken, verifyGoogleIdToken } from "./nativeIdentity";
import { unregisterDeviceToken } from "./nativePush";
import { verifyPlaybackToken } from "./playbackLink";
import { MIN_MOBILE_VERSION_SETTING, MOBILE_CLIENT_HEADER, MOBILE_CLIENT_VALUE, isValidVersion, type MobileConfig } from "@shared/mobile";

/**
 * Routes the mobile app (F1) needs beyond what the web uses. Additive only:
 * nothing here changes how the web app signs in.
 *
 * Sessions: the app keeps the same 30-day session JWT the web keeps in a
 * cookie, but in the device keychain, and sends it as a bearer token
 * (getSessionFromRequest). It gets the token by calling the existing
 * /api/auth/login and /api/auth/signup with `X-Client: mobile`, which adds
 * `token` to the success body (mobileTokenResponder), or from the native
 * Google/Apple endpoints below.
 */

export function publicUser(user: Pick<User, "id" | "email" | "name" | "role">) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Carries the password fingerprint when the row has one, so a password change also signs the app out. */
function issueToken(user: Pick<User, "id" | "email" | "role"> & { passwordHash?: string | null }) {
  return createSessionToken({ userId: user.id, email: user.email, role: user.role, ...(user.passwordHash !== undefined ? { passwordHash: user.passwordHash } : {}) });
}

export function isMobileRequest(req: Request) {
  return String(req.get(MOBILE_CLIENT_HEADER) ?? "").toLowerCase() === MOBILE_CLIENT_VALUE;
}

/**
 * Wraps /api/auth/login and /api/auth/signup for the app. The handlers set the
 * session cookie as always; this captures the token they put in it and adds
 * it to a successful JSON body. Browsers never send X-Client, so web
 * responses are untouched.
 */
export function mobileTokenResponder(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "POST" || !isMobileRequest(req)) return next();
  let token: string | null = null;
  const originalCookie = res.cookie.bind(res);
  res.cookie = ((name: string, value: unknown, options?: unknown) => {
    if (typeof value === "string" && verifySessionToken(value)) token = value;
    return (originalCookie as any)(name, value, options);
  }) as typeof res.cookie;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (token && res.statusCode < 400 && body && typeof body === "object" && (body as { success?: unknown }).success === true) {
      return originalJson({ ...(body as object), token });
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
}

async function loadUser(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function getMobileConfig(env: NodeJS.ProcessEnv = process.env): Promise<MobileConfig> {
  let minVersion: string | null = null;
  try {
    const stored = (await getAppSetting(MIN_MOBILE_VERSION_SETTING))?.value?.trim();
    if (stored && isValidVersion(stored)) minVersion = stored;
  } catch {
    // appSettings missing or the database is down: never lock people out of the app over it.
  }
  if (!minVersion && env.MOBILE_MIN_VERSION && isValidVersion(env.MOBILE_MIN_VERSION.trim())) minVersion = env.MOBILE_MIN_VERSION.trim();
  return {
    minVersion,
    storeUrls: { ios: env.MOBILE_APP_STORE_URL || null, android: env.MOBILE_PLAY_STORE_URL || null },
  };
}

function readSignupFields(body: any) {
  return {
    mode: body?.mode === "signup" ? ("signup" as const) : ("login" as const),
    inviteCode: typeof body?.inviteCode === "string" ? body.inviteCode : null,
    consented: body?.acceptedTerms === true && body?.confirmedAge === true,
  };
}

export function registerMobileRoutes(app: Express) {
  app.use(["/api/auth/login", "/api/auth/signup"], mobileTokenResponder);

  /** Exchanges a still-valid token for a fresh 30-day one, so a phone used every few weeks never signs out. */
  app.post("/api/auth/token/refresh", authLimiter, async (req: Request, res: Response) => {
    const token = getBearerToken(req);
    const session = token ? verifySessionToken(token) : null;
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    try {
      const user = await loadUser(session.userId);
      if (!user) {
        res.status(401).json({ error: "Account not found" });
        return;
      }
      // A token from before a password change must not be refreshed into a valid one.
      if (!(await sessionIsValid(session, user))) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      res.json({ success: true, token: issueToken(user), user: publicUser(user) });
    } catch (error) {
      console.error("[MobileAuth] refresh failed", error);
      res.status(500).json({ error: "Could not refresh the session" });
    }
  });

  /**
   * Sign out on the device. The token itself is stateless (like the cookie) and
   * the app deletes it from the keychain; this stops push to that device.
   */
  app.post("/api/auth/token/logout", async (req: Request, res: Response) => {
    const token = getBearerToken(req);
    const session = token ? verifySessionToken(token) : null;
    const pushToken = typeof req.body?.pushToken === "string" ? req.body.pushToken : null;
    try {
      if (session && pushToken) await unregisterDeviceToken(session.userId, pushToken);
    } catch (error) {
      console.error("[MobileAuth] could not remove device token", error);
    }
    await revokeSession(session);
    res.json({ success: true });
  });

  app.post("/api/auth/google/native", authLimiter, async (req: Request, res: Response) => {
    const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }
    try {
      const identity = await verifyGoogleIdToken(idToken);
      const outcome = await completeNativeSocialAuth(identity, { ...readSignupFields(req.body), ip: req.ip ?? "unknown" });
      if ("error" in outcome) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ success: true, created: outcome.created, token: issueToken(outcome.user), user: publicUser(outcome.user) });
    } catch (error) {
      if (error instanceof IdentityTokenError) {
        res.status(401).json({ error: error.message });
        return;
      }
      console.error("[MobileAuth] Google native sign-in failed", error);
      res.status(500).json({ error: "Google sign-in failed" });
    }
  });

  app.post("/api/auth/apple/native", authLimiter, async (req: Request, res: Response) => {
    const identityToken = typeof req.body?.identityToken === "string" ? req.body.identityToken : "";
    if (!identityToken) {
      res.status(400).json({ error: "identityToken is required" });
      return;
    }
    try {
      const identity = await verifyAppleIdentityToken(identityToken, {
        rawNonce: typeof req.body?.rawNonce === "string" ? req.body.rawNonce : null,
        fullName: typeof req.body?.fullName === "string" ? req.body.fullName : null,
      });
      const outcome = await completeNativeSocialAuth(identity, { ...readSignupFields(req.body), ip: req.ip ?? "unknown" });
      if ("error" in outcome) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ success: true, created: outcome.created, token: issueToken(outcome.user), user: publicUser(outcome.user) });
    } catch (error) {
      if (error instanceof IdentityTokenError) {
        res.status(401).json({ error: error.message });
        return;
      }
      console.error("[MobileAuth] Apple native sign-in failed", error);
      res.status(500).json({ error: error instanceof Error && /not available yet/.test(error.message) ? error.message : "Apple sign-in failed" });
    }
  });

  /** Checked by the app on launch: below minVersion it asks the person to update (lets APIs change safely). */
  app.get("/api/mobile/config", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getMobileConfig());
  });

  /** Audio for the app's player, authorized by a signed link from mobile.playbackUrl (server/playbackLink.ts). */
  app.get("/api/storage/playback/:token/:filename", async (req: Request, res: Response) => {
    const grant = verifyPlaybackToken(req.params.token);
    if (!grant) {
      res.status(403).send("This playback link is invalid or has expired");
      return;
    }
    try {
      const recording = await getRecordingByAudioKey(grant.key);
      if (!recording || recording.id !== grant.recordingId) {
        res.status(404).send("Recording not found");
        return;
      }
      const isOwner = recording.userId === grant.userId;
      if (isOwner ? await isTransferLimitReached() : await isTransferSoftCapReached()) {
        res.status(503).send(TRANSFER_PAUSED_MESSAGE);
        return;
      }
      await streamStoredAudio(req, res, grant.key);
    } catch (error) {
      console.error("[MobilePlayback] read failed:", error);
      res.status(502).send("Recording storage is temporarily unavailable");
    }
  });
}
