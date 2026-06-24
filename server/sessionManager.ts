import { Response } from "express";
import jwt from "jsonwebtoken";
const { sign, verify } = jwt;

const JWT_SECRET = process.env.JWT_SECRET || "default-dev-secret-change-in-production";
const SESSION_COOKIE_NAME = "scribesync_session";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionData {
  userId: number;
  email: string;
  role: "admin" | "user";
  iat?: number;
  exp?: number;
}

/**
 * Create a session token
 */
export function createSessionToken(data: Omit<SessionData, "iat" | "exp">): string {
  return sign(data, JWT_SECRET, {
    expiresIn: "30d",
  }) as string;
}

/**
 * Verify and decode a session token
 */
export function verifySessionToken(token: string): SessionData | null {
  try {
    const decoded = verify(token, JWT_SECRET) as SessionData;
    return decoded;
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
export function getSessionFromCookie(cookieHeader?: string): SessionData | null {
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
