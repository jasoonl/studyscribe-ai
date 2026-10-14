import { Response } from "express";
import jwt from "jsonwebtoken";
import type { Request } from "express";
const { sign, verify } = jwt;

import { createHash } from "node:crypto";
import { getJwtSecret } from "./_core/secrets";
const SESSION_COOKIE_NAME = "studyscribe_session";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionData {
  userId: number;
  email: string;
  role: "admin" | "user";
  /**
   * Password version: a short hash of the account's password hash when the
   * session was made. Changing or resetting the password changes it, which
   * signs out every other session (`sessionMatchesUser`). Absent on sessions
   * made before Phase 6, which stay valid until they expire.
   */
  pv?: string;
  iat?: number;
  exp?: number;
}

/**
 * Create a session token
 */
export function passwordFingerprint(passwordHash: string | null | undefined): string {
  return createHash("sha256").update(`pv:${passwordHash ?? ""}`).digest("base64url").slice(0, 16);
}

export function createSessionToken(data: { userId: number; email: string; role: "admin" | "user"; passwordHash?: string | null }): string {
  const payload: Omit<SessionData, "iat" | "exp"> = { userId: data.userId, email: data.email, role: data.role };
  if (data.passwordHash !== undefined) payload.pv = passwordFingerprint(data.passwordHash);
  return sign(payload, getJwtSecret(), {
    expiresIn: "30d",
  }) as string;
}

/** False when the session was made before the account's password last changed. */
export function sessionMatchesUser(session: Pick<SessionData, "pv">, user: { passwordHash?: string | null }): boolean {
  return session.pv === undefined || session.pv === passwordFingerprint(user.passwordHash);
}

/** Session tokens only: other tokens signed with the same secret (OAuth state, email links) have other shapes. */
function isSessionShape(value: unknown): value is SessionData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if ("purpose" in data || "provider" in data || "nonce" in data) return false;
  return Number.isInteger(data.userId) && typeof data.email === "string" && (data.role === "admin" || data.role === "user");
}

/**
 * Verify and decode a session token
 */
export function verifySessionToken(token: string): SessionData | null {
  try {
    const decoded = verify(token, getJwtSecret(), { algorithms: ["HS256"] });
    return isSessionShape(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Set session cookie in response
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION,
    path: "/",
  });
}

/**
 * Clear session cookie
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Get session from cookie
 */
export function getSessionFromCookie(req: Request | string | undefined): SessionData | null {
  let cookieHeader: string | undefined;
  
  if (typeof req === 'string') {
    cookieHeader = req;
  } else if (req && typeof req === 'object' && 'headers' in req) {
    cookieHeader = (req as any).headers.cookie;
  }
  
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").reduce(
    (acc, cookie) => {
      const [name, value] = cookie.trim().split("=");
      acc[name] = decodeURIComponent(value);
      return acc;
    },
    {} as Record<string, string>
  );

  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  return verifySessionToken(token);
}
