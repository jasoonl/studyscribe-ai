import { eq } from "drizzle-orm";
import type { Request } from "express";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { getSessionFromCookie, sessionMatchesUser, type SessionData } from "./sessionManager";

/**
 * The cookie session for a REST route, checked against the account the way
 * tRPC's context checks it: the account still exists and the session was made
 * after its password last changed. Null otherwise.
 */
export async function getVerifiedSession(req: Request): Promise<SessionData | null> {
  const session = getSessionFromCookie(req);
  if (!session) return null;
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.id, session.userId)).limit(1);
  return user && sessionMatchesUser(session, user) ? session : null;
}
