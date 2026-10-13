import { TRPCError } from "@trpc/server";
import { type SQL, and, eq, inArray, or, sql } from "drizzle-orm";
import { groupShares, organizationCourses, organizationMembers, recordingCourses, recordingShares, recordings, studyGroupMembers, studyGroups } from "../drizzle/schema";
import { type AccessRole, type ShareRole, roleAllows, strongestRole } from "@shared/sharing";
import { getDb, getRecordingById } from "./db";
import { isSchemaMissingError, isUnknownColumnError, tolerateMissingSchema } from "./schemaTolerance";

/**
 * Who may do what with a recording (D3, D2, F3). Access comes from four
 * places: owning it, a direct share (recordingShares.role), membership of a
 * study group the recording, or the course it is filed under, was shared to,
 * or membership of a team whose shared library holds that course (view
 * only). The strongest grant wins. Every procedure that serves shared content goes
 * through `requireRecordingAccess` so the role is checked on the server.
 */

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export type ShareRow = {
  id: number;
  recordingId: number;
  ownerId: number;
  sharedWithUserId: number;
  sharedWithEmail: string;
  role: ShareRole;
  createdAt: Date;
};

const legacyShareColumns = {
  id: recordingShares.id,
  recordingId: recordingShares.recordingId,
  ownerId: recordingShares.ownerId,
  sharedWithUserId: recordingShares.sharedWithUserId,
  sharedWithEmail: recordingShares.sharedWithEmail,
  createdAt: recordingShares.createdAt,
};

/**
 * Reads share rows. Before migration 0022 the `role` column does not exist,
 * so the read is retried without it and every share counts as view-only,
 * which is what shares were before roles.
 */
export async function selectShares(where: SQL | undefined): Promise<ShareRow[]> {
  const db = await requireDb();
  try {
    return (await db.select({ ...legacyShareColumns, role: recordingShares.role }).from(recordingShares).where(where)) as ShareRow[];
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    const rows = await db.select(legacyShareColumns).from(recordingShares).where(where);
    return rows.map(row => ({ ...row, role: "view" as const }));
  }
}

export function getSharesForRecording(recordingId: number) {
  return selectShares(eq(recordingShares.recordingId, recordingId));
}

export async function getDirectShare(recordingId: number, userId: number): Promise<ShareRow | null> {
  const rows = await selectShares(and(eq(recordingShares.recordingId, recordingId), eq(recordingShares.sharedWithUserId, userId)));
  return rows[0] ?? null;
}

/** Creates or updates a direct share. A non-view role needs migration 0022. */
export async function upsertDirectShare(data: { recordingId: number; ownerId: number; sharedWithUserId: number; sharedWithEmail: string; role: ShareRole }) {
  const db = await requireDb();
  try {
    await db
      .insert(recordingShares)
      .values(data)
      .onDuplicateKeyUpdate({ set: { sharedWithEmail: data.sharedWithEmail, role: data.role } });
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    if (data.role !== "view") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Comment and edit roles are not set up on this server yet. Share as view only for now." });
    }
    // Raw SQL: drizzle would still list the missing `role` column (as DEFAULT).
    await db.execute(
      sql`insert into recordingShares (recordingId, ownerId, sharedWithUserId, sharedWithEmail) values (${data.recordingId}, ${data.ownerId}, ${data.sharedWithUserId}, ${data.sharedWithEmail}) on duplicate key update sharedWithEmail = ${data.sharedWithEmail}`,
    );
  }
}

export async function setDirectShareRole(recordingId: number, sharedWithUserId: number, role: ShareRole) {
  const db = await requireDb();
  try {
    await db
      .update(recordingShares)
      .set({ role })
      .where(and(eq(recordingShares.recordingId, recordingId), eq(recordingShares.sharedWithUserId, sharedWithUserId)));
  } catch (error) {
    if (isUnknownColumnError(error)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Share roles are not set up on this server yet." });
    }
    throw error;
  }
}

/** Group ids the person belongs to (empty before migration 0022). */
export async function groupIdsForUser(userId: number): Promise<number[]> {
  const db = await requireDb();
  return tolerateMissingSchema(
    "groups",
    async () => (await db.select({ groupId: studyGroupMembers.groupId }).from(studyGroupMembers).where(eq(studyGroupMembers.userId, userId))).map(row => row.groupId),
    [] as number[],
  );
}

async function courseIdForRecording(recordingId: number): Promise<number | null> {
  const db = await requireDb();
  try {
    const rows = await db.select({ courseId: recordingCourses.courseId }).from(recordingCourses).where(eq(recordingCourses.recordingId, recordingId)).limit(1);
    return rows[0]?.courseId ?? null;
  } catch (error) {
    if (isSchemaMissingError(error)) return null;
    throw error;
  }
}

/** The strongest role any of the person's groups has on this recording, directly or through its course. */
export async function getGroupRole(recordingId: number, userId: number): Promise<ShareRole | null> {
  const groupIds = await groupIdsForUser(userId);
  if (groupIds.length === 0) return null;
  const courseId = await courseIdForRecording(recordingId);
  const db = await requireDb();
  const itemMatch =
    courseId !== null
      ? or(
          and(eq(groupShares.itemType, "recording"), eq(groupShares.itemId, recordingId)),
          and(eq(groupShares.itemType, "course"), eq(groupShares.itemId, courseId)),
        )
      : and(eq(groupShares.itemType, "recording"), eq(groupShares.itemId, recordingId));
  const rows = await tolerateMissingSchema(
    "groups",
    () => db.select({ role: groupShares.role }).from(groupShares).where(and(inArray(groupShares.groupId, groupIds), itemMatch)),
    [] as Array<{ role: ShareRole }>,
  );
  return strongestRole(rows.map(row => row.role));
}

/**
 * "view" when the recording's course is in the shared library of the team the
 * person belongs to, and the course's owner is still in that team.
 */
export async function getOrgRole(recordingId: number, ownerId: number, userId: number): Promise<ShareRole | null> {
  const db = await requireDb();
  const memberships = await tolerateMissingSchema(
    "teams",
    () => db.select({ orgId: organizationMembers.orgId, userId: organizationMembers.userId }).from(organizationMembers).where(inArray(organizationMembers.userId, [userId, ownerId])),
    [] as Array<{ orgId: number; userId: number }>,
  );
  const mine = memberships.find(row => row.userId === userId)?.orgId;
  const owners = memberships.find(row => row.userId === ownerId)?.orgId;
  if (!mine || mine !== owners) return null;
  const courseId = await courseIdForRecording(recordingId);
  if (courseId === null) return null;
  const rows = await tolerateMissingSchema(
    "teams",
    () => db.select({ id: organizationCourses.id }).from(organizationCourses).where(and(eq(organizationCourses.orgId, mine), eq(organizationCourses.courseId, courseId))).limit(1),
    [] as Array<{ id: number }>,
  );
  return rows.length ? "view" : null;
}

export type RecordingRow = NonNullable<Awaited<ReturnType<typeof getRecordingById>>>;

/** The person's role on a recording, or null when they have no access (or it is in the trash). */
export async function getRecordingAccess(recordingId: number, userId: number): Promise<{ recording: RecordingRow; role: AccessRole } | null> {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.isDeleted) return null;
  if (recording.userId === userId) return { recording, role: "owner" };
  const [direct, viaGroup, viaTeam] = await Promise.all([getDirectShare(recordingId, userId), getGroupRole(recordingId, userId), getOrgRole(recordingId, recording.userId, userId)]);
  const role = strongestRole<ShareRole>([direct?.role, viaGroup, viaTeam]);
  return role ? { recording, role } : null;
}

/**
 * Throws unless the person has at least `needed` on the recording. No access
 * at all reads as "not found" so recording ids cannot be probed.
 */
export async function requireRecordingAccess(recordingId: number, userId: number, needed: AccessRole) {
  const access = await getRecordingAccess(recordingId, userId);
  if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
  if (!roleAllows(access.role, needed)) {
    const what = needed === "owner" ? "Only the owner can do that." : needed === "edit" ? "You need edit access to do that." : "You need comment access to do that.";
    throw new TRPCError({ code: "FORBIDDEN", message: what });
  }
  return access;
}

export type SharedRecordingListItem = {
  recordingId: number;
  title: string;
  duration: number | null;
  status: string | null;
  createdAt: Date;
  ownerId: number;
  sharedAt: Date;
  role: ShareRole;
  /** Group names the recording reaches the person through, if any. */
  viaGroups: string[];
};

/** Everything shared with the person, directly or through groups, with the strongest role for each. */
export async function listRecordingsSharedWithUser(userId: number): Promise<SharedRecordingListItem[]> {
  const db = await requireDb();
  const byId = new Map<number, SharedRecordingListItem>();

  const direct = await selectShares(eq(recordingShares.sharedWithUserId, userId));
  const directIds = direct.map(share => share.recordingId);
  const groupIds = await groupIdsForUser(userId);

  const groupRows = groupIds.length
    ? await tolerateMissingSchema(
        "groups",
        () =>
          db
            .select({ share: groupShares, groupName: studyGroups.name })
            .from(groupShares)
            .innerJoin(studyGroups, eq(studyGroups.id, groupShares.groupId))
            .where(inArray(groupShares.groupId, groupIds)),
        [] as Array<{ share: typeof groupShares.$inferSelect; groupName: string }>,
      )
    : [];

  // Expand course shares to the recordings filed under each course.
  const courseIds = groupRows.filter(row => row.share.itemType === "course").map(row => row.share.itemId);
  const courseLinks = courseIds.length
    ? await tolerateMissingSchema(
        "courses",
        () => db.select({ recordingId: recordingCourses.recordingId, courseId: recordingCourses.courseId }).from(recordingCourses).where(inArray(recordingCourses.courseId, courseIds)),
        [] as Array<{ recordingId: number; courseId: number }>,
      )
    : [];

  const grants: Array<{ recordingId: number; role: ShareRole; at: Date; via?: string }> = [
    ...direct.map(share => ({ recordingId: share.recordingId, role: share.role, at: share.createdAt })),
  ];
  for (const row of groupRows) {
    if (row.share.itemType === "recording") grants.push({ recordingId: row.share.itemId, role: row.share.role, at: row.share.createdAt, via: row.groupName });
    else {
      for (const link of courseLinks.filter(link => link.courseId === row.share.itemId)) {
        grants.push({ recordingId: link.recordingId, role: row.share.role, at: row.share.createdAt, via: row.groupName });
      }
    }
  }
  const ids = Array.from(new Set([...directIds, ...grants.map(grant => grant.recordingId)]));
  if (ids.length === 0) return [];

  const recordingRows = await db
    .select({ id: recordings.id, title: recordings.title, duration: recordings.duration, status: recordings.status, createdAt: recordings.createdAt, userId: recordings.userId })
    .from(recordings)
    .where(and(inArray(recordings.id, ids), eq(recordings.isDeleted, 0)));
  const recordingById = new Map(recordingRows.map(row => [row.id, row]));

  for (const grant of grants) {
    const recording = recordingById.get(grant.recordingId);
    if (!recording || recording.userId === userId) continue;
    const existing = byId.get(grant.recordingId);
    if (!existing) {
      byId.set(grant.recordingId, {
        recordingId: recording.id,
        title: recording.title,
        duration: recording.duration,
        status: recording.status,
        createdAt: recording.createdAt,
        ownerId: recording.userId,
        sharedAt: grant.at,
        role: grant.role,
        viaGroups: grant.via ? [grant.via] : [],
      });
      continue;
    }
    existing.role = strongestRole<ShareRole>([existing.role, grant.role]) ?? existing.role;
    if (grant.at > existing.sharedAt) existing.sharedAt = grant.at;
    if (grant.via && !existing.viaGroups.includes(grant.via)) existing.viaGroups.push(grant.via);
  }
  return Array.from(byId.values()).sort((a, b) => b.sharedAt.getTime() - a.sharedAt.getTime());
}

/** Shares where the person is the recipient, newest first (used by account export). */
export async function listDirectSharesFor(userId: number) {
  return selectShares(eq(recordingShares.sharedWithUserId, userId));
}
