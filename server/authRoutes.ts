import type { Express, Request, Response } from "express";
import { loginWithEmailPassword, registerWithEmailPassword, loginWithGoogle, loginWithGoogleExistingOnly, validateInviteCode, createPasswordResetRequest, resetPasswordWithToken } from "./authService";
import { createSessionToken, setSessionCookie, clearSessionCookie, getSessionFromCookie } from "./sessionManager";
import { getDb, getPasswordResetTokenByToken } from "./db";
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

      const origin = (req.query.origin as string) || `${req.protocol}://${req.get("host")}`;
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

      const origin =
        stateData.origin || `${req.protocol}://${req.get("host")}`;
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

      const result = await createPasswordResetRequest(email);

      if (result.error) {
        // Always return success to avoid email enumeration
        res.json({ success: true, message: "If email exists, password reset link will be sent" });
        return;
      }

      // TODO: Send email with reset link
      // For now, return the token (in production, send via email)
      res.json({
        success: true,
        message: "Password reset link sent to email",
        token: result.token, // Remove in production
      });
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
