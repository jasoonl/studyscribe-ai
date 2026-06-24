import type { Express, Request, Response } from "express";
import { loginWithEmailPassword, registerWithEmailPassword, loginWithGoogle, validateInviteCode } from "./authService";
import { createSessionToken, setSessionCookie, clearSessionCookie, getSessionFromCookie } from "./sessionManager";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { exchangeGoogleCode, getOrCreateGoogleUser, getGoogleAuthUrl, getGoogleRedirectUri, isGoogleOAuthConfigured } from "./googleOAuthHandler";

export function registerAuthRoutes(app: Express) {
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
   * Clear session cookie
   */
  app.post("/api/auth/logout", (req: Request, res: Response) => {
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
      const session = getSessionFromCookie(req.headers.cookie);

      if (!session) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database connection failed" });
        return;
      }

      const dbUser = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (dbUser.length === 0) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      res.json({
        id: dbUser[0].id,
        email: dbUser[0].email,
        name: dbUser[0].name,
        role: dbUser[0].role,
      });
    } catch (error) {
      console.error("[Auth] Get me failed", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  /**
   * POST /api/auth/google
   * Initiate Google OAuth flow - returns the Google consent URL
   */
  app.post("/api/auth/google", (req: Request, res: Response) => {
    try {
      if (!isGoogleOAuthConfigured()) {
        res.status(503).json({
          error:
            "Google sign-in is not configured yet. Please contact the site owner.",
        });
        return;
      }

      // The origin the user is on (e.g. https://app.example.com). Falls back to
      // the request origin header when not provided by the client.
      const origin =
        (req.body && req.body.origin) ||
        (req.headers.origin as string) ||
        `${req.protocol}://${req.get("host")}`;

      const redirectUri = getGoogleRedirectUri(origin);

      // Generate state for CSRF protection, carrying the origin so the callback
      // can rebuild the exact same redirect URI.
      const state = Buffer.from(JSON.stringify({ origin })).toString("base64");

      // Get Google auth URL
      const googleAuthUrl = getGoogleAuthUrl(state, redirectUri);

      res.json({ authUrl: googleAuthUrl });
    } catch (error) {
      console.error("[Auth] Google init failed", error);
      res.status(500).json({ error: "Failed to initiate Google auth" });
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
   * GET /api/auth/google/callback
   * Handle Google OAuth callback
   */
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code || !state) {
        res.status(400).json({ error: "code and state are required" });
        return;
      }

      // Decode state to get the origin used to start the flow
      let stateData: { origin?: string };
      try {
        stateData = JSON.parse(Buffer.from(state, "base64").toString());
      } catch {
        res.status(400).json({ error: "Invalid state parameter" });
        return;
      }

      const origin =
        stateData.origin || `${req.protocol}://${req.get("host")}`;
      const redirectUri = getGoogleRedirectUri(origin);

      // Exchange Google code for tokens
      const result = await exchangeGoogleCode(code, redirectUri);

      if (!result || !result.user) {
        res.status(400).json({ error: "Failed to exchange Google code" });
        return;
      }

      // Get or create user in database
      const user = await getOrCreateGoogleUser(result.user);

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
      res.redirect(302, "/dashboard");
    } catch (error) {
      console.error("[Auth] Google callback failed", error);
      res.status(500).json({ error: "Google callback failed" });
    }
  });
}


