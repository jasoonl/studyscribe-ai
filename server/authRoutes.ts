import type { Express, Request, Response } from "express";
import { SSO_REQUIRED_MESSAGE, ssoRequiredForEmail } from "./ssoEnforcement";
import { loginWithEmailPassword, registerWithEmailPassword, registerOpenSignup, loginWithGoogleExistingOnly, validateInviteCode, resetPasswordWithToken, createPasswordResetRequest } from "./authService";
import { createSessionToken, setSessionCookie, clearSessionCookie, getSessionFromCookie } from "./sessionManager";
import { deletePasswordResetToken, getDb, getPasswordResetTokenByToken } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { exchangeGoogleCode, getGoogleAuthUrl, getGoogleRedirectUri, isGoogleOAuthConfigured } from "./googleOAuthHandler";
import { readOAuthState, safeNextPath } from "./googleSignup";
import { autoJoinByDomain } from "./organizations";
import { registerSsoRoutes } from "./ssoRoutes";
import { completeGoogleSignup } from "./googleSignupFlow";
import { getSafeApplicationOrigin, isTransactionalEmailConfigured, sendPasswordResetEmail } from "./email";
import { authLimiter, passwordResetLimiter } from "./_core/rateLimit";
import { MIN_AGE } from "@shared/legal";
import { countRecentSignups, decideSignupPath, isOpenSignupEnabled, openSignupDailyCap, registerEmailVerificationRoutes, sendVerificationLink, signupLimiter } from "./openSignup";

export function registerAuthRoutes(app: Express) {
  registerEmailVerificationRoutes(app);
  registerSsoRoutes(app);

  /**
   * POST /api/auth/login
   * Email/password login
   */
  app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
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

      // A team that requires single sign-on refuses passwords for its domain (owner excepted).
      if (result.user && (await ssoRequiredForEmail(result.user.email, result.user.id))) {
        res.status(403).json({ error: SSO_REQUIRED_MESSAGE, sso: true });
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
  app.post("/api/auth/signup", authLimiter, signupLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password, name, inviteCode, acceptedTerms, confirmedAge } = req.body;

      if (!email || !password || !name) {
        res.status(400).json({ error: "Email, password and name are required" });
        return;
      }

      if (confirmedAge !== true) {
        res.status(400).json({ error: `You must confirm you are at least ${MIN_AGE} years old to create an account` });
        return;
      }

      if (typeof email === "string" && (await ssoRequiredForEmail(email))) {
        res.status(403).json({ error: SSO_REQUIRED_MESSAGE, sso: true });
        return;
      }

      // An invite always works; without one, only while open sign-up is on.
      const hasInvite = typeof inviteCode === "string" && inviteCode.trim().length > 0;
      const decision = decideSignupPath({
        inviteCode: hasInvite ? inviteCode : null,
        openSignup: hasInvite ? false : await isOpenSignupEnabled(),
        recentSignups: hasInvite ? 0 : await countRecentSignups(),
        dailyCap: openSignupDailyCap(),
      });
      if (decision.path === "closed") {
        res.status(400).json({ error: decision.reason });
        return;
      }

      const result = decision.path === "invite"
        ? await registerWithEmailPassword(email, password, name, inviteCode, acceptedTerms === true)
        : await registerOpenSignup(String(email), String(password), String(name), acceptedTerms === true);

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

      let confirmationSent = false;
      if (decision.path === "open") {
        try {
          confirmationSent = (await sendVerificationLink(result.user, req.get("origin") ?? undefined)).sent;
        } catch (error) {
          // The account exists; the dashboard offers to send the link again.
          console.error("[Auth] Verification email failed", error);
        }
      }

      res.json({
        success: true,
        confirmationSent,
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
  app.post("/api/auth/validate-invite", authLimiter, async (req: Request, res: Response) => {
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

      // Sign-up must carry the age and Terms confirmations ticked on the sign-up page.
      const consented = req.query.acceptedTerms === "1" && req.query.confirmedAge === "1";
      const invite = typeof req.query.inviteCode === "string" ? req.query.inviteCode.trim().slice(0, 64) : "";
      const next = safeNextPath(req.query.next) ?? undefined;
      const authUrl = getGoogleAuthUrl(origin, mode === "signup" ? "signup" : "login", undefined, mode === "signup" && consented, invite || undefined, next);

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

      // The state is signed (server/googleSignup.ts): an edited or expired one is refused.
      const stateData = readOAuthState(state);
      if (!stateData) {
        const fallback = getSafeApplicationOrigin(undefined);
        res.redirect(302, `${fallback}/login?error=${encodeURIComponent("That sign-in link expired or was changed. Please try again.")}`);
        return;
      }

      const origin = getSafeApplicationOrigin(stateData.origin);
      const mode = stateData.mode;
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
        if (stateData.consented !== true) {
          res.redirect(302, `${origin}/login?error=${encodeURIComponent(`To sign up, confirm you are at least ${MIN_AGE} and accept the Terms on the sign-up page.`)}`);
          return;
        }
        // Check before an account exists, so a refused sign-up leaves nothing behind.
        if (await ssoRequiredForEmail(result.user.email)) {
          res.redirect(302, `${origin}/login?sso=1&error=${encodeURIComponent(SSO_REQUIRED_MESSAGE)}`);
          return;
        }
        const outcome = await completeGoogleSignup(result.user, stateData.invite, req.ip ?? "unknown");
        if ("error" in outcome) {
          res.redirect(302, `${origin}/login?error=${encodeURIComponent(outcome.error)}`);
          return;
        }
        user = outcome.user;
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

      if (await ssoRequiredForEmail(user.email, user.id)) {
        res.redirect(302, `${origin}/login?sso=1&error=${encodeURIComponent(SSO_REQUIRED_MESSAGE)}`);
        return;
      }

      // Create session token and set cookie
      const token = createSessionToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      setSessionCookie(res, token);

      // A Google Workspace account from a team's verified domain joins that team (F3).
      await autoJoinByDomain(user, result.user.hostedDomain);

      res.redirect(302, `${origin}${stateData.next ?? "/dashboard"}`);
    } catch (error) {
      console.error("[Auth] Google callback failed", error);
      res.status(500).json({ error: "Google callback failed" });
    }
  });

  /**
   * POST /api/auth/forgot-password
   * Request a password reset token
   */
  app.post("/api/auth/forgot-password", passwordResetLimiter, async (req: Request, res: Response) => {
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
  app.post("/api/auth/reset-password", passwordResetLimiter, async (req: Request, res: Response) => {
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
