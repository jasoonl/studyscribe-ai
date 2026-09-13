import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserByEmail as dbGetUserByEmail, getUserByGoogleId, upsertUser, createInviteCode, getInviteCodeByCode, markInviteCodeAsUsed, createPasswordResetToken, getPasswordResetTokenByToken, deletePasswordResetToken, getDb, normalizeAuthEmail } from './db';
import { User } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { users } from '../drizzle/schema';

const SALT_ROUNDS = 10;
const INVITE_CODE_LENGTH = 32;
const INVITE_EXPIRY_DAYS = 7;
const PASSWORD_RESET_EXPIRY_MINUTES = 30;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a password with its hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a random invite code
 */
export function generateInviteCode(): string {
  return crypto.randomBytes(INVITE_CODE_LENGTH / 2).toString('hex');
}

/**
 * Generate a random password reset token
 */
export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate an invite code
 */
export async function validateInviteCode(code: string): Promise<{ valid: boolean; email?: string; error?: string }> {
  try {
    const invite = await getInviteCodeByCode(code);

    if (!invite) {
      return { valid: false, error: 'Invalid invite code' };
    }

    if (invite.isUsed) {
      return { valid: false, error: 'Invite code already used' };
    }

    if (new Date() > invite.expiresAt) {
      return { valid: false, error: 'Invite code expired' };
    }

    return { valid: true, email: invite.email };
  } catch (error) {
    console.error('[Auth] Invite validation error:', error);
    return { valid: false, error: 'Failed to validate invite code' };
  }
}

/**
 * Register a new user with email and password
 * Requires a valid invite code
 */
export async function getUserByEmail(email: string) {
  return dbGetUserByEmail(email);
}
export async function registerWithEmailPassword(
  email: string,
  password: string,
  name: string,
  inviteCode: string
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: string }> {
  try {
    const normalizedEmail = normalizeAuthEmail(email);
    // Validate invite code
    const invite = await getInviteCodeByCode(inviteCode);
    
    if (!invite) {
      return { error: 'Invalid invite code' };
    }

    if (invite.isUsed) {
      return { error: 'Invite code already used' };
    }

    if (new Date() > invite.expiresAt) {
      return { error: 'Invite code expired' };
    }

    if (normalizeAuthEmail(invite.email) !== normalizedEmail) {
      return { error: 'Email does not match invite' };
    }

    // Check if user already exists
    const existingUser = await dbGetUserByEmail(normalizedEmail);
    if (existingUser) {
      return { error: 'Email already registered' };
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const db = await getDb();
    if (!db) {
      return { error: 'Database not available' };
    }

    await upsertUser({
      email: normalizedEmail,
      passwordHash,
      name: name || null,
      loginMethod: 'email',
      emailVerified: 1, // Verified via invite code
      lastSignedIn: new Date(),
    });

    // Mark invite as used
    const userId = (await dbGetUserByEmail(normalizedEmail))?.id;
    if (userId) {
      await markInviteCodeAsUsed(inviteCode, userId);
    }

    const user = await dbGetUserByEmail(normalizedEmail);
    if (!user) {
      return { error: 'Failed to create user' };
    }

    return { user };
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    return { error: 'Registration failed' };
  }
}

/**
 * Login with email and password
 */
export async function loginWithEmailPassword(
  email: string,
  password: string
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: string }> {
  try {
    const normalizedEmail = normalizeAuthEmail(email);
    const user = await dbGetUserByEmail(normalizedEmail);

    if (!user || !user.passwordHash) {
      return { error: 'Invalid email or password' };
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);

    if (!isPasswordValid) {
      return { error: 'Invalid email or password' };
    }

    // Update last signed in
    const db = await getDb();
    if (db) {
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
    }

    return { user };
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return { error: 'Login failed' };
  }
}

/**
 * Login with Google OAuth - existing users only (for login page)
 * Rejects unknown users to enforce invite-gated signup
 */
export async function loginWithGoogleExistingOnly(
  googleId: string,
  email: string,
  name: string
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: string }> {
  try {
    // Check if user exists by Google ID
    let user = await getUserByGoogleId(googleId);

    if (user) {
      // Update last signed in
      const db = await getDb();
      if (db) {
        await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      }
      return { user };
    }

    // Check if user exists by email
    user = await getUserByEmail(normalizeAuthEmail(email));

    if (user) {
      // Link Google ID to existing user
      const db = await getDb();
      if (db) {
        await db.update(users).set({
          googleId,
          lastSignedIn: new Date(),
        }).where(eq(users.id, user.id));
      }
      return { user };
    }

    // User does not exist - reject (no auto-create for login)
    return { error: 'User not found. Please sign up with an invite code first.' };
  } catch (error) {
    console.error('[Auth] Google login error:', error);
    return { error: 'Google login failed' };
  }
}

/**
 * Login or register with Google OAuth - auto-creates for signup
 */
export async function loginWithGoogle(
  googleId: string,
  email: string,
  name: string
): Promise<{ user: User; isNewUser: boolean; error?: undefined } | { user?: undefined; isNewUser?: undefined; error: string }> {
  try {
    // Check if user exists by Google ID
    let user = await getUserByGoogleId(googleId);

    if (user) {
      // Update last signed in
      const db = await getDb();
      if (db) {
        await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      }
      return { user, isNewUser: false };
    }

    // Check if user exists by email
    user = await getUserByEmail(normalizeAuthEmail(email));

    if (user) {
      // Link Google ID to existing user
      const db = await getDb();
      if (db) {
        await db.update(users).set({
          googleId,
          lastSignedIn: new Date(),
        }).where(eq(users.id, user.id));
      }
      return { user, isNewUser: false };
    }

    // Create new user
    await upsertUser({
      email: normalizeAuthEmail(email),
      googleId,
      name: name || null,
      loginMethod: 'google',
      emailVerified: 1, // Google emails are verified
      lastSignedIn: new Date(),
    });

    const newUser = await getUserByEmail(email);
    if (!newUser) {
      return { error: 'Failed to create user' };
    }

    return { user: newUser, isNewUser: true };
  } catch (error) {
    console.error('[Auth] Google login error:', error);
    return { error: 'Google login failed' };
  }
}

/**
 * Create a password reset request
 */
export async function createPasswordResetRequest(email: string): Promise<{ token?: string; recipient?: string; error?: string }> {
  try {
    const user = await dbGetUserByEmail(email);

    // Keep the public response identical for unknown and Google-only accounts.
    if (!user || !user.passwordHash) {
      return {};
    }

    const token = generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

    await createPasswordResetToken({
      userId: user.id,
      token,
      expiresAt,
    });

    return { token, recipient: user.email };
  } catch (error) {
    console.error('[Auth] Password reset request error:', error);
    return { error: 'Password reset request failed' };
  }
}

/**
 * Reset password with token
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: string }> {
  try {
    const resetToken = await getPasswordResetTokenByToken(token);

    if (!resetToken) {
      return { error: 'Invalid password reset token' };
    }

    if (new Date() > resetToken.expiresAt) {
      await deletePasswordResetToken(token);
      return { error: 'Password reset token expired' };
    }

    const db = await getDb();
    if (!db) {
      return { error: 'Database not available' };
    }

    const passwordHash = await hashPassword(newPassword);

    await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId));

    await deletePasswordResetToken(token);

    const user = await db.select().from(users).where(eq(users.id, resetToken.userId)).limit(1);

    if (!user || user.length === 0) {
      return { error: 'User not found' };
    }

    return { user: user[0] };
  } catch (error) {
    console.error('[Auth] Password reset error:', error);
    return { error: 'Password reset failed' };
  }
}

/**
 * Create an invite code (admin only)
 */
export async function createInvite(
  email: string,
  createdBy: number
): Promise<{ code: string; error?: undefined } | { code?: undefined; error: string }> {
  try {
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await createInviteCode({
      code,
      email,
      createdBy,
      expiresAt,
    });

    return { code };
  } catch (error) {
    console.error('[Auth] Create invite error:', error);
    return { error: 'Failed to create invite' };
  }
}
