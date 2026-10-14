import { and, eq, gt } from "drizzle-orm";
import { sessionRevocations } from "../drizzle/schema";
import { isMissingTableError } from "./bookmarks";
import { getDb } from "./db";
import { sessionMatchesUser, type SessionData } from "./sessionManager";

/**
 * Real sign-out (Phase 7, carried over from Phase 6). Session tokens are stateless JWTs;
 * these rows make one stop working early (sign out) or every one an account made before a
 * moment (sign out everywhere). Before migration 0033 nothing is revoked, as before.
 */

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type RevocationRow = { sid: string | null; cutoffAt: Date | null };

/** Pure: whether any of the account's revocations covers this session. */
export function isRevokedBy(rows: RevocationRow[], session: Pick<SessionData, "sid" | "iat">): boolean {
  return rows.some((row) => {
    if (row.sid) return Boolean(session.sid) && row.sid === session.sid;
    // Sessions without an issue time can't be placed before or after a cutoff, so a cutoff covers them.
    return row.cutoffAt !== null && (session.iat === undefined || row.cutoffAt.getTime() / 1000 > session.iat);
  });
}

export async function isSessionRevoked(session: SessionData): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const rows = await db
      .select({ sid: sessionRevocations.sid, cutoffAt: sessionRevocations.cutoffAt })
      .from(sessionRevocations)
      .where(and(eq(sessionRevocations.userId, session.userId), gt(sessionRevocations.expiresAt, new Date())));
    return isRevokedBy(rows, session);
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}

/** The one check for an accepted session: the password hasn't changed since, and it hasn't been signed out. */
export async function sessionIsValid(session: SessionData, user: { passwordHash?: string | null }): Promise<boolean> {
  return sessionMatchesUser(session, user) && !(await isSessionRevoked(session));
}

/** Signs out one session. Sessions made before Phase 7 have no id and expire on their own. */
export async function revokeSession(session: SessionData | null): Promise<void> {
  if (!session?.sid) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(sessionRevocations).values({
      userId: session.userId,
      sid: session.sid,
      expiresAt: new Date(session.exp ? session.exp * 1000 : Date.now() + SESSION_LIFETIME_MS),
    });
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[sessions] could not revoke a session:", error);
  }
}

/** Signs out every session the account has, on every device. Throws if it can't, so the person is told. */
export async function revokeAllSessions(userId: number, now = new Date()): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.insert(sessionRevocations).values({
      userId,
      sid: null,
      // Whole seconds, like a token's issue time; sessions made later in this second stay valid.
      cutoffAt: new Date(Math.floor(now.getTime() / 1000) * 1000),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    });
  } catch (error) {
    if (isMissingTableError(error)) throw new Error("Signing out of every device is not available on this server yet.");
    throw error;
  }
}

export async function deleteSessionRevocationsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(sessionRevocations).where(eq(sessionRevocations.userId, userId)).catch((error) => {
    if (!isMissingTableError(error)) throw error;
  });
}
