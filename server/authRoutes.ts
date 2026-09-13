import type { Express, Request, Response } from "express";
import { loginWithEmailPassword, registerWithEmailPassword, loginWithGoogle, loginWithGoogleExistingOnly, validateInviteCode, resetPasswordWithToken, createPasswordResetRequest } from "./authService";
import { createSessionToken, setSessionCookie, clearSessionCookie, getSessionFromCookie } from "./sessionManager";
import { deletePasswordResetToken, getDb, getPasswordResetTokenByToken, getExternalDatabaseConfig } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { exchangeGoogleCode, getOrCreateGoogleUser, getGoogleAuthUrl, getGoogleRedirectUri, isGoogleOAuthConfigured } from "./googleOAuthHandler";
import { getSafeApplicationOrigin, isTransactionalEmailConfigured, sendPasswordResetEmail } from "./email";
import { createInviteCode } from "./db";
import { generateInviteCode } from "./authService";

const TEMP_DIAG_TOKEN = "578b9640d0df376872029f64d0627380e98148b9d7268a82";

export function registerAuthRoutes(app: Express) {
  /**
   * TEMPORARY read-only diagnostic route. No secrets are exposed: only a
   * user count, the DB host suffix in use, and whether a queried email
   * exists (boolean + login method), never a hash or full email of anyone
   * else. Remove after the current launch-readiness investigation.
   */
  app.get("/api/admin/diag", async (req: Request, res: Response) => {
    try {
      if (req.query.token !== TEMP_DIAG_TOKEN) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const config = getExternalDatabaseConfig();
      let hostInfo: { kind: string; host?: string; database?: string } | null = null;
      if (config) {
        if (config.kind === "tidb") {
          hostInfo = { kind: "tidb-fields", host: config.host, database: config.database };
        } else {
          try {
            const parsed = new URL(config.url);
            hostInfo = { kind: "url", host: parsed.hostname, database: parsed.pathname.replace(/^\//, "") };
          } catch {
            hostInfo = { kind: "url", host: "unparseable" };
          }
        }
      }

      const db = await getDb();
      if (!db) {
        res.json({ dbAvailable: false, hostInfo });
        return;
      }
      const all = await db.select({
        id: users.id,
        email: users.email,
        loginMethod: users.loginMethod,
        hasPasswordHash: users.passwordHash,
        hasGoogleId: users.googleId,
        role: users.role,
      }).from(users);

      const queryEmail = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : undefined;
      let match: any = null;
      if (queryEmail) {
        const found = all.find((u) => u.email.trim().toLowerCase() === queryEmail);
        match = found
          ? {
              found: true,
              loginMethod: found.loginMethod,
              hasPassword: Boolean(found.hasPasswordHash),
              hasGoogleId: Boolean(found.hasGoogleId),
              role: found.role,
            }
          : { found: false };
      }

      res.json({
        dbAvailable: true,
        userCount: all.length,
        loginMethods: all.reduce((acc: Record<string, number>, u) => {
          const key = u.loginMethod || "unknown";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        emailDomains: [...new Set(all.map((u) => u.email.split("@")[1]))],
        queryMatch: match,
        hostInfo,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Diagnostic failed" });
    }
  });

  /**
   * TEMPORARY bootstrap route. Only usable while the users table is empty
   * (this production database currently has zero accounts, which is why no
   * one can sign in yet). Generates a real invite code for the given email
   * so the owner can sign up through the normal /signup flow. Remove after
   * the owner has an account.
   */
  app.post("/api/admin/bootstrap-invite", async (req: Request, res: Response) => {
    try {
      if (req.query.token !== TEMP_DIAG_TOKEN) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const email = typeof req.query.email === "string" ? req.query.email.trim() : undefined;
      if (!email) {
        res.status(400).json({ error: "email query param required" });
        return;
      }
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database not available" });
        return;
      }
      const existing = await db.select({ id: users.id }).from(users).limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "Users already exist; refusing to bootstrap again" });
        return;
      }

      const code = generateInviteCode();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await createInviteCode({ code, email, createdBy: 0, expiresAt });

      res.json({ inviteCode: code, email, expiresAt });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Bootstrap failed" });
    }
  });

  /**
   * TEMPORARY one-time data migration route. Copies every row from the
   * owner's old Manus-hosted TiDB database into this production database,
   * table by table, preserving primary keys so foreign-key-style columns
   * (userId, recordingId, etc.) stay consistent. Source credentials are
   * supplied per-request in the POST body — never stored in the repo or
   * logged. Uses INSERT IGNORE so it is safe to re-run. Remove this route
   * once the migration is verified.
   */
  app.post("/api/admin/migrate-from-manus", async (req: Request, res: Response) => {
    try {
      if (req.query.token !== TEMP_DIAG_TOKEN) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const { host, port, user, password, database } = req.body || {};
      if (!host || !port || !user || !password || !database) {
        res.status(400).json({ error: "host, port, user, password, database required in JSON body" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Target database not available" });
        return;
      }
      const targetPool = (db as any).$client;
      if (!targetPool || typeof targetPool.promise !== "function") {
        res.status(500).json({ error: "Could not access target database client" });
        return;
      }
      const targetConn = targetPool.promise();

      const { createConnection } = await import("mysql2/promise");
      const source = await createConnection({
        host,
        port: Number(port),
        user,
        password,
        database,
        ssl: { rejectUnauthorized: true },
      });

      const tableOrder = [
        "users",
        "recordings",
        "transcripts",
        "studyNotes",
        "flashcards",
        "flashcardReviews",
        "chatHistory",
        "tags",
        "recordingTags",
        "noteTags",
        "userNotifications",
        "pushSubscriptions",
        "inviteCodes",
        "passwordResetTokens",
        "inviteRequests",
        "studyGuides",
        "quizzes",
        "quizAttempts",
        "emailDrafts",
      ];

      // Clear the earlier temporary bootstrap invite (createdBy sentinel 0) so
      // its auto-incremented id cannot collide with a real migrated invite code.
      await targetConn.query("DELETE FROM `inviteCodes` WHERE createdBy = 0");

      const summary: Record<string, { sourceRows: number; inserted: number }> = {};

      for (const table of tableOrder) {
        const [rows] = await source.query(`SELECT * FROM \`${table}\``);
        const rowList = rows as Record<string, any>[];
        let inserted = 0;
        for (const row of rowList) {
          const columns = Object.keys(row);
          const columnsSql = columns.map((c) => `\`${c}\``).join(", ");
          const placeholders = columns.map(() => "?").join(", ");
          const values = columns.map((c) => {
            const v = row[c];
            const isPlainObjectOrArray =
              v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v);
            return isPlainObjectOrArray ? JSON.stringify(v) : v;
          });
          const [result] = await targetConn.query(
            `INSERT IGNORE INTO \`${table}\` (${columnsSql}) VALUES (${placeholders})`,
            values
          );
          if ((result as any).affectedRows > 0) inserted++;
        }
        summary[table] = { sourceRows: rowList.length, inserted };
      }

      await source.end();

      res.json({ success: true, summary });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Migration failed" });
    }
  });

  /**
   * POST /api/auth/login
   * Email/password login
   */
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const result = await loginWithEmailPassword(email, password);

      if (result.error) {
        res.status(401).json({ error: result.error });
        return;
      }

      if (!result.user) {
        res.status(500).json({ error: "User not found after login" });
        return;
      }

      // Create session token and set cookie
      const token = createSessionToken({
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
      });

      setSessionCookie(res, token);

      res.json({
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
      });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  /**
   * POST /api/auth/signup
   * Email/password signup with invite code
   */
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const { email, password, name, inviteCode } = req.body;

      if (!email || !password || !name || !inviteCode) {
        res.status(400).json({ error: "Email, password, name, and invite code are required" });
        return;
      }

      const result = await registerWithEmailPassword(email, password, name, inviteCode);

      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      if (!result.user) {
        res.status(500).json({ error: "User not created" });
        return;
      }

      // Create session token and set cookie
      const token = createSessionToken({
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
      });

      setSessionCookie(res, token);

      res.json({
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
      });
    } catch (error) {
      console.error("[Auth] Signup failed", error);
      res.status(500).json({ error: "Signup failed" });
    }
  });

  /**
   * POST /api/auth/logout
   * Clear session
   */
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Logout failed", error);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  /**
   * GET /api/auth/me
   * Get current user from session
   */
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const session = getSessionFromCookie(req);

      if (!session) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database connection failed" });
        return;
      }

      const userResults = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      
      const user = userResults[0];

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    } catch (error) {
      console.error("[Auth] Get me failed", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  /**
   * POST /api/auth/validate-invite
   * Validate an invite code
   */
  app.post("/api/auth/validate-invite", async (req: Request, res: Response) => {
    try {
      const { code } = req.body;

      if (!code) {
        res.status(400).json({ error: "Invite code is required" });
        return;
      }

      const result = await validateInviteCode(code);

      if (result.valid) {
        res.json({
          valid: true,
          email: result.email,
        });
      } else {
        res.json({
          valid: false,
          error: result.error || "Invalid invite code",
        });
      }
    } catch (error) {
      console.error("[Auth] Validate invite failed", error);
      res.status(500).json({ error: "Failed to validate invite code" });
    }
  });

  /**
   * GET /api/auth/google
   * Initiate Google OAuth flow
   */
  app.get("/api/auth/google", async (req: Request, res: Response) => {
    try {
      if (!isGoogleOAuthConfigured()) {
        res.status(503).json({ error: "Google OAuth is not configured" });
        return;
      }

      const origin = getSafeApplicationOrigin(
        typeof req.query.origin === "string" ? req.query.origin : undefined,
      );
      const mode = ((req.query.mode as string) || "login") as "login" | "signup";

      const authUrl = getGoogleAuthUrl(origin, mode);

      res.json({ authUrl });
    } catch (error) {
      console.error("[Auth] Google init failed", error);
      res.status(500).json({ error: "Failed to initialize Google OAuth" });
    }
  });

  /**
   * GET /api/auth/google/callback
   * Handle Google OAuth callback - different logic for login vs signup
   */
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code || !state) {
        res.status(400).json({ error: "code and state are required" });
        return;
      }

      // Decode state to get the origin and mode
      let stateData: { origin?: string; mode?: "login" | "signup" };
      try {
        stateData = JSON.parse(Buffer.from(state, "base64").toString());
      } catch {
        res.status(400).json({ error: "Invalid state parameter" });
        return;
      }

      const origin = getSafeApplicationOrigin(stateData.origin);
      const mode = stateData.mode || "login";
      const redirectUri = getGoogleRedirectUri(origin);

      // Exchange Google code for tokens
      const result = await exchangeGoogleCode(code, redirectUri);

      if (!result || !result.user) {
        res.status(400).json({ error: "Failed to exchange Google code" });
        return;
      }

      // Use different auth logic based on mode
      let user;
      if (mode === "signup") {
        // Signup: allow auto-creating new users
        user = await getOrCreateGoogleUser(result.user);
      } else {
        // Login: existing users only
        const authResult = await loginWithGoogleExistingOnly(
          result.user.id,
          result.user.email,
          result.user.name
        );
        if (authResult.error) {
          // Redirect to login page with error
          res.redirect(302, `${origin}/login?error=${encodeURIComponent(authResult.error)}`);
          return;
        }
        user = authResult.user;
      }

      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }

      // Create session token and set cookie
      const token = createSessionToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      setSessionCookie(res, token);

      // Redirect to dashboard
      res.redirect(302, `${origin}/dashboard`);
    } catch (error) {
      console.error("[Auth] Google callback failed", error);
      res.status(500).json({ error: "Google callback failed" });
    }
  });

  /**
   * POST /api/auth/forgot-password
   * Request a password reset token
   */
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      if (!isTransactionalEmailConfigured()) {
        res.status(503).json({ error: "Password reset email delivery is temporarily unavailable. Please try again later." });
        return;
      }

      const resetRequest = await createPasswordResetRequest(email);
      if (resetRequest.error) {
        res.status(503).json({ error: "Password reset email delivery is temporarily unavailable. Please try again later." });
        return;
      }

      if (resetRequest.token && resetRequest.recipient) {
        const origin = getSafeApplicationOrigin((req.body?.origin as string | undefined) ?? req.get("origin"));
        const resetUrl = new URL("/reset-password", origin);
        resetUrl.searchParams.set("token", resetRequest.token);
        try {
          await sendPasswordResetEmail({ to: resetRequest.recipient, resetUrl: resetUrl.toString() });
        } catch (deliveryError) {
          await deletePasswordResetToken(resetRequest.token);
          console.error("[Auth] Password reset email delivery failed", deliveryError);
          res.status(503).json({ error: "Password reset email delivery is temporarily unavailable. Please try again later." });
          return;
        }
      }

      // Never expose account existence, provider type, or reset credentials.
      res.json({ success: true, message: "If an eligible account exists, a password reset link has been sent." });
    } catch (error) {
      console.error("[Auth] Forgot password failed", error);
      res.status(500).json({ error: "Failed to process password reset request" });
    }
  });

  /**
   * POST /api/auth/reset-password
   * Reset password with token
   */
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        res.status(400).json({ error: "Token and new password are required" });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }

      const result = await resetPasswordWithToken(token, newPassword);

      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      if (!result.user) {
        res.status(500).json({ error: "Failed to retrieve user after password reset" });
        return;
      }

      res.json({
        success: true,
        message: "Password reset successful",
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
        },
      });
    } catch (error) {
      console.error("[Auth] Reset password failed", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  /**
   * GET /api/auth/validate-reset-token
   * Validate a password reset token
   */
  app.get("/api/auth/validate-reset-token", async (req: Request, res: Response) => {
    try {
      const token = req.query.token as string;

      if (!token) {
        res.status(400).json({ error: "Token is required" });
        return;
      }

      const resetToken = await getPasswordResetTokenByToken(token);

      if (!resetToken) {
        res.status(400).json({ error: "Invalid token" });
        return;
      }

      if (new Date() > resetToken.expiresAt) {
        res.status(400).json({ error: "Token expired" });
        return;
      }

      res.json({ valid: true });
    } catch (error) {
      console.error("[Auth] Validate token failed", error);
      res.status(500).json({ error: "Failed to validate token" });
    }
  });
}
