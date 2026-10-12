import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { courses, groupShares, recordingCourses, recordings, studyGroupMembers, studyGroups, users } from "../drizzle/schema";
import { SHARE_ROLES, roleAllows } from "@shared/sharing";
import { recentCommentsOn } from "./annotations";
import { notifyUser } from "./collabNotifications";
import { getDb, getUserByEmail, normalizeAuthEmail } from "./db";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Study groups (D2): a named set of members who share recordings and whole
 * courses with each other at a role (view, comment or edit). Access through a
 * group is resolved by server/recordingAccess.ts like a direct share. The
 * tables arrive with migration 0022.
 */

const FEATURE = "Study groups";
export const MAX_GROUPS_PER_USER = 50;
export const MAX_MEMBERS_PER_GROUP = 200;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export function newJoinToken() {
  return randomBytes(18).toString("base64url");
}

async function membership(groupId: number, userId: number) {
  const db = await requireDb();
  const rows = await explainMissingSchema(FEATURE, () =>
    db
      .select({ group: studyGroups, role: studyGroupMembers.role })
      .from(studyGroups)
      .innerJoin(studyGroupMembers, and(eq(studyGroupMembers.groupId, studyGroups.id), eq(studyGroupMembers.userId, userId)))
      .where(eq(studyGroups.id, groupId))
      .limit(1),
  );
  return rows[0] ?? null;
}

async function requireMember(groupId: number, userId: number) {
  const row = await membership(groupId, userId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
  return row;
}

async function requireGroupOwner(groupId: number, userId: number) {
  const row = await requireMember(groupId, userId);
  if (row.role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the group's owner can do that." });
  return row;
}

async function memberCount(groupId: number) {
  const db = await requireDb();
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(studyGroupMembers).where(eq(studyGroupMembers.groupId, groupId));
  return Number(row?.total ?? 0);
}

async function addMember(groupId: number, userId: number) {
  if ((await memberCount(groupId)) >= MAX_MEMBERS_PER_GROUP) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A group can have up to ${MAX_MEMBERS_PER_GROUP} members.` });
  }
  const db = await requireDb();
  await db.insert(studyGroupMembers).values({ groupId, userId, role: "member" }).onDuplicateKeyUpdate({ set: { groupId } });
}

/** Removes a member and everything they shared to the group, so leaving stops sharing too. */
async function removeMemberAndShares(groupId: number, userId: number) {
  const db = await requireDb();
  await db.delete(groupShares).where(and(eq(groupShares.groupId, groupId), eq(groupShares.sharedBy, userId)));
  await db.delete(studyGroupMembers).where(and(eq(studyGroupMembers.groupId, groupId), eq(studyGroupMembers.userId, userId)));
}

async function deleteGroupRows(groupIds: number[]) {
  if (groupIds.length === 0) return;
  const db = await requireDb();
  await db.delete(groupShares).where(inArray(groupShares.groupId, groupIds));
  await db.delete(studyGroupMembers).where(inArray(studyGroupMembers.groupId, groupIds));
  await db.delete(studyGroups).where(inArray(studyGroups.id, groupIds));
}

export async function deleteGroupSharesForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingSchema(
    "groups",
    () => db.delete(groupShares).where(and(eq(groupShares.itemType, "recording"), inArray(groupShares.itemId, recordingIds))),
    undefined,
  );
}

/** Account deletion: groups the person owns go entirely; elsewhere they leave and their shares go. */
export async function deleteGroupDataForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema(
    "groups",
    async () => {
      const owned = await db.select({ id: studyGroups.id }).from(studyGroups).where(eq(studyGroups.ownerId, userId));
      await deleteGroupRows(owned.map(row => row.id));
      await db.delete(groupShares).where(eq(groupShares.sharedBy, userId));
      await db.delete(studyGroupMembers).where(eq(studyGroupMembers.userId, userId));
    },
    undefined,
  );
}

export async function exportGroupDataForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "groups",
    async () => ({
      groupsOwned: (await db.select().from(studyGroups).where(eq(studyGroups.ownerId, userId))).map(({ joinToken, ...rest }) => rest),
      groupMemberships: await db
        .select({ groupId: studyGroupMembers.groupId, role: studyGroupMembers.role, joinedAt: studyGroupMembers.createdAt, groupName: studyGroups.name })
        .from(studyGroupMembers)
        .innerJoin(studyGroups, eq(studyGroups.id, studyGroupMembers.groupId))
        .where(eq(studyGroupMembers.userId, userId)),
      groupShares: await db.select().from(groupShares).where(eq(groupShares.sharedBy, userId)),
    }),
    { groupsOwned: [], groupMemberships: [], groupShares: [] },
  );
}

async function memberIds(groupId: number) {
  const db = await requireDb();
  return (await db.select({ userId: studyGroupMembers.userId }).from(studyGroupMembers).where(eq(studyGroupMembers.groupId, groupId))).map(row => row.userId);
}

const shareRoleInput = z.enum(SHARE_ROLES);
const groupFields = z.object({
  name: z.string().trim().min(1, "Give the group a name").max(120),
  description: z.string().trim().max(500).optional(),
});

export const groupsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await tolerateMissingSchema(
      "groups",
      () =>
        db
          .select({ id: studyGroups.id, name: studyGroups.name, description: studyGroups.description, createdAt: studyGroups.createdAt, role: studyGroupMembers.role })
          .from(studyGroupMembers)
          .innerJoin(studyGroups, eq(studyGroups.id, studyGroupMembers.groupId))
          .where(eq(studyGroupMembers.userId, ctx.user.id))
          .orderBy(asc(studyGroups.name)),
      null,
    );
    if (rows === null) return { available: false, groups: [] };
    if (rows.length === 0) return { available: true, groups: [] };
    const ids = rows.map(row => row.id);
    const [members, shares] = await Promise.all([
      db.select({ groupId: studyGroupMembers.groupId, total: sql<number>`count(*)` }).from(studyGroupMembers).where(inArray(studyGroupMembers.groupId, ids)).groupBy(studyGroupMembers.groupId),
      db.select({ groupId: groupShares.groupId, total: sql<number>`count(*)`, latest: sql<Date>`max(${groupShares.createdAt})` }).from(groupShares).where(inArray(groupShares.groupId, ids)).groupBy(groupShares.groupId),
    ]);
    const memberMap = new Map(members.map(row => [row.groupId, Number(row.total)]));
    const shareMap = new Map(shares.map(row => [row.groupId, { total: Number(row.total), latest: row.latest }]));
    return {
      available: true,
      groups: rows.map(row => ({
        ...row,
        memberCount: memberMap.get(row.id) ?? 1,
        itemCount: shareMap.get(row.id)?.total ?? 0,
        lastSharedAt: shareMap.get(row.id)?.latest ?? null,
      })),
    };
  }),

  create: protectedProcedure.input(groupFields).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    return explainMissingSchema(FEATURE, async () => {
      const [owned] = await db.select({ total: sql<number>`count(*)` }).from(studyGroups).where(eq(studyGroups.ownerId, ctx.user.id));
      if (Number(owned?.total ?? 0) >= MAX_GROUPS_PER_USER) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `You can run up to ${MAX_GROUPS_PER_USER} groups.` });
      }
      const [result] = await db.insert(studyGroups).values({ ownerId: ctx.user.id, name: input.name, description: input.description || null, joinToken: newJoinToken() });
      const id = Number((result as any).insertId);
      await db.insert(studyGroupMembers).values({ groupId: id, userId: ctx.user.id, role: "owner" });
      return { id };
    });
  }),

  get: protectedProcedure.input(z.object({ groupId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const { group, role } = await requireMember(input.groupId, ctx.user.id);
    const db = await requireDb();

    const memberRows = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: studyGroupMembers.role, joinedAt: studyGroupMembers.createdAt })
      .from(studyGroupMembers)
      .innerJoin(users, eq(users.id, studyGroupMembers.userId))
      .where(eq(studyGroupMembers.groupId, group.id))
      .orderBy(asc(studyGroupMembers.createdAt));
    const nameOf = new Map(memberRows.map(row => [row.userId, row.name?.trim() || row.email.split("@")[0]]));

    const shareRows = await db.select().from(groupShares).where(eq(groupShares.groupId, group.id)).orderBy(desc(groupShares.createdAt));
    const recordingIds = shareRows.filter(row => row.itemType === "recording").map(row => row.itemId);
    const courseIds = shareRows.filter(row => row.itemType === "course").map(row => row.itemId);

    const courseRows = courseIds.length
      ? await tolerateMissingSchema("courses", () => db.select({ id: courses.id, name: courses.name, color: courses.color, userId: courses.userId }).from(courses).where(inArray(courses.id, courseIds)), [])
      : [];
    const courseLinks = courseIds.length
      ? await tolerateMissingSchema(
          "courses",
          () => db.select({ recordingId: recordingCourses.recordingId, courseId: recordingCourses.courseId }).from(recordingCourses).where(inArray(recordingCourses.courseId, courseIds)),
          [] as Array<{ recordingId: number; courseId: number }>,
        )
      : [];
    const allRecordingIds = Array.from(new Set([...recordingIds, ...courseLinks.map(link => link.recordingId)]));
    const recordingRows = allRecordingIds.length
      ? await db
          .select({ id: recordings.id, title: recordings.title, duration: recordings.duration, userId: recordings.userId, createdAt: recordings.createdAt, status: recordings.status })
          .from(recordings)
          .where(and(inArray(recordings.id, allRecordingIds), eq(recordings.isDeleted, 0)))
      : [];
    const recordingById = new Map(recordingRows.map(row => [row.id, row]));
    const courseById = new Map(courseRows.map(row => [row.id, row]));

    type ItemBase = { shareId: number; role: (typeof SHARE_ROLES)[number]; sharedAt: Date; sharedBy: number; sharedByName: string; canManage: boolean };
    type RecordingBrief = { id: number; title: string; duration: number | null; mine: boolean };
    type GroupItem =
      | (ItemBase & { type: "recording"; recording: RecordingBrief })
      | (ItemBase & { type: "course"; course: { id: number; name: string; color: string; mine: boolean }; recordings: RecordingBrief[] });
    const items = shareRows.flatMap((share): GroupItem[] => {
      const base = {
        shareId: share.id,
        role: share.role,
        sharedAt: share.createdAt,
        sharedBy: share.sharedBy,
        sharedByName: nameOf.get(share.sharedBy) ?? "A former member",
        canManage: share.sharedBy === ctx.user.id || role === "owner",
      };
      if (share.itemType === "recording") {
        const recording = recordingById.get(share.itemId);
        if (!recording) return [];
        return [{ ...base, type: "recording" as const, recording: { id: recording.id, title: recording.title, duration: recording.duration, mine: recording.userId === ctx.user.id } }];
      }
      const course = courseById.get(share.itemId);
      if (!course) return [];
      const inCourse = courseLinks
        .filter(link => link.courseId === course.id)
        .map(link => recordingById.get(link.recordingId))
        .filter((row): row is NonNullable<typeof row> => !!row)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return [
        {
          ...base,
          type: "course" as const,
          course: { id: course.id, name: course.name, color: course.color, mine: course.userId === ctx.user.id },
          recordings: inCourse.map(row => ({ id: row.id, title: row.title, duration: row.duration, mine: row.userId === ctx.user.id })),
        },
      ];
    });

    // Comments are only for recordings the group can comment on (or the viewer owns).
    const commentable = new Set<number>();
    for (const item of items) {
      const list = item.type === "recording" ? [item.recording] : item.recordings;
      for (const recording of list) if (recording.mine || roleAllows(item.role, "comment")) commentable.add(recording.id);
    }
    const comments = await recentCommentsOn(Array.from(commentable), 12);
    const titleOf = (id: number) => recordingById.get(id)?.title ?? "A recording";
    const linkFor = (id: number) => (recordingById.get(id)?.userId === ctx.user.id ? `/recording/${id}` : `/shared-with-me/${id}`);

    type FeedEntry =
      | { kind: "shared"; at: Date; actor: string; title: string; href: string; itemType: "recording" | "course"; role: string }
      | { kind: "comment"; at: Date; actor: string; title: string; href: string; body: string; quote: string; isReply: boolean };
    const feed: FeedEntry[] = [
      ...items.map(item => ({
        kind: "shared" as const,
        at: item.sharedAt,
        actor: item.sharedByName,
        title: item.type === "recording" ? item.recording.title : item.course.name,
        href: item.type === "recording" ? linkFor(item.recording.id) : `#group-item-${item.shareId}`,
        itemType: item.type,
        role: item.role,
      })),
      ...comments.map(comment => ({
        kind: "comment" as const,
        at: comment.createdAt,
        actor: comment.authorName,
        title: titleOf(comment.recordingId),
        href: linkFor(comment.recordingId),
        body: comment.body,
        quote: comment.quote,
        isReply: comment.isReply,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 20);

    return {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        createdAt: group.createdAt,
        joinToken: role === "owner" ? group.joinToken : null,
      },
      myRole: role,
      members: memberRows.map(row => ({ userId: row.userId, name: nameOf.get(row.userId)!, email: role === "owner" || row.userId === ctx.user.id ? row.email : null, role: row.role, joinedAt: row.joinedAt })),
      items,
      feed,
    };
  }),

  update: protectedProcedure.input(groupFields.extend({ groupId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    await requireGroupOwner(input.groupId, ctx.user.id);
    const db = await requireDb();
    await db.update(studyGroups).set({ name: input.name, description: input.description || null }).where(eq(studyGroups.id, input.groupId));
    return { id: input.groupId };
  }),

  remove: protectedProcedure.input(z.object({ groupId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    await requireGroupOwner(input.groupId, ctx.user.id);
    await deleteGroupRows([input.groupId]);
    return { removed: true };
  }),

  /** Adds an existing StudyScribe account straight away and tells them. */
  invite: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive(), email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      if (!checkTrpcRateLimit(`group-invite:${ctx.user.id}`, 60 * 60 * 1000, 60)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many invites in an hour. Try again later." });
      }
      const { group } = await requireGroupOwner(input.groupId, ctx.user.id);
      const invitee = await getUserByEmail(normalizeAuthEmail(input.email));
      if (!invitee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No StudyScribe account uses that email. Send them the join link once they have signed up." });
      }
      if (await membership(group.id, invitee.id)) throw new TRPCError({ code: "CONFLICT", message: "They are already in this group." });
      await addMember(group.id, invitee.id);
      await notifyUser(invitee.id, {
        title: `You were added to ${group.name}`,
        message: `${ctx.user.name || ctx.user.email} added you to the study group "${group.name}".`,
        url: `/groups/${group.id}`,
        tag: `group-${group.id}`,
      });
      return { added: invitee.email };
    }),

  setJoinLink: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await requireGroupOwner(input.groupId, ctx.user.id);
      const db = await requireDb();
      const joinToken = input.enabled ? newJoinToken() : null;
      await db.update(studyGroups).set({ joinToken }).where(eq(studyGroups.id, input.groupId));
      return { joinToken };
    }),

  previewJoin: protectedProcedure.input(z.object({ token: z.string().min(10).max(64) })).query(async ({ input, ctx }) => {
    const db = await requireDb();
    const [group] = await explainMissingSchema(FEATURE, () => db.select().from(studyGroups).where(eq(studyGroups.joinToken, input.token)).limit(1));
    if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "This join link is not valid any more. Ask the group's owner for a new one." });
    const isMember = !!(await membership(group.id, ctx.user.id));
    return { groupId: group.id, name: group.name, description: group.description, memberCount: await memberCount(group.id), isMember };
  }),

  join: protectedProcedure.input(z.object({ token: z.string().min(10).max(64) })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [group] = await explainMissingSchema(FEATURE, () => db.select().from(studyGroups).where(eq(studyGroups.joinToken, input.token)).limit(1));
    if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "This join link is not valid any more. Ask the group's owner for a new one." });
    if (!(await membership(group.id, ctx.user.id))) {
      await addMember(group.id, ctx.user.id);
      await notifyUser(group.ownerId, {
        title: `${ctx.user.name || ctx.user.email} joined ${group.name}`,
        message: `They joined with the group's link.`,
        url: `/groups/${group.id}`,
        tag: `group-${group.id}`,
      });
    }
    return { groupId: group.id };
  }),

  leave: protectedProcedure.input(z.object({ groupId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const { role } = await requireMember(input.groupId, ctx.user.id);
    if (role === "owner") throw new TRPCError({ code: "BAD_REQUEST", message: "You own this group. Delete it instead, or it would be left without an owner." });
    await removeMemberAndShares(input.groupId, ctx.user.id);
    return { left: true };
  }),

  removeMember: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await requireGroupOwner(input.groupId, ctx.user.id);
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself from your own group." });
      await removeMemberAndShares(input.groupId, input.userId);
      return { removed: true };
    }),

  /** Share one of your recordings or courses with a group you are in. */
  share: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive(), itemType: z.enum(["recording", "course"]), itemId: z.number().int().positive(), role: shareRoleInput.default("comment") }))
    .mutation(async ({ input, ctx }) => {
      const { group } = await requireMember(input.groupId, ctx.user.id);
      const db = await requireDb();
      let title: string;
      if (input.itemType === "recording") {
        const [recording] = await db.select().from(recordings).where(eq(recordings.id, input.itemId)).limit(1);
        if (!recording || recording.isDeleted || recording.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        title = recording.title;
      } else {
        const [course] = await tolerateMissingSchema("courses", () => db.select().from(courses).where(and(eq(courses.id, input.itemId), eq(courses.userId, ctx.user.id))).limit(1), []);
        if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
        title = course.name;
      }
      await db
        .insert(groupShares)
        .values({ groupId: group.id, sharedBy: ctx.user.id, itemType: input.itemType, itemId: input.itemId, role: input.role })
        .onDuplicateKeyUpdate({ set: { role: input.role } });
      const others = (await memberIds(group.id)).filter(id => id !== ctx.user.id).slice(0, 50);
      for (const userId of others) {
        await notifyUser(userId, {
          title: `New in ${group.name}`,
          message: `${ctx.user.name || ctx.user.email} shared ${input.itemType === "course" ? `the course "${title}"` : `"${title}"`} with the group.`,
          url: `/groups/${group.id}`,
          tag: `group-${group.id}`,
        });
      }
      return { shared: true };
    }),

  setShareRole: protectedProcedure
    .input(z.object({ shareId: z.number().int().positive(), role: shareRoleInput }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [share] = await explainMissingSchema(FEATURE, () => db.select().from(groupShares).where(eq(groupShares.id, input.shareId)).limit(1));
      if (!share) throw new TRPCError({ code: "NOT_FOUND", message: "That share no longer exists." });
      const { role } = await requireMember(share.groupId, ctx.user.id);
      if (share.sharedBy !== ctx.user.id && role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only whoever shared it, or the group's owner, can change this." });
      await db.update(groupShares).set({ role: input.role }).where(eq(groupShares.id, share.id));
      return { role: input.role };
    }),

  unshare: protectedProcedure.input(z.object({ shareId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [share] = await explainMissingSchema(FEATURE, () => db.select().from(groupShares).where(eq(groupShares.id, input.shareId)).limit(1));
    if (!share) return { removed: true };
    const { role } = await requireMember(share.groupId, ctx.user.id);
    if (share.sharedBy !== ctx.user.id && role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only whoever shared it, or the group's owner, can remove it." });
    await db.delete(groupShares).where(eq(groupShares.id, share.id));
    return { removed: true };
  }),

  /** For the share dialog: your groups, and which of them already have this recording (directly or through its course). */
  forRecording: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = await requireDb();
    const groups = await tolerateMissingSchema(
      "groups",
      () =>
        db
          .select({ id: studyGroups.id, name: studyGroups.name })
          .from(studyGroupMembers)
          .innerJoin(studyGroups, eq(studyGroups.id, studyGroupMembers.groupId))
          .where(eq(studyGroupMembers.userId, ctx.user.id))
          .orderBy(asc(studyGroups.name)),
      null,
    );
    if (groups === null) return { available: false, groups: [] };
    if (groups.length === 0) return { available: true, groups: [] };
    const [recording] = await db.select({ userId: recordings.userId }).from(recordings).where(eq(recordings.id, input.recordingId)).limit(1);
    if (!recording || recording.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
    const [link] = await tolerateMissingSchema(
      "courses",
      () => db.select({ courseId: recordingCourses.courseId }).from(recordingCourses).where(eq(recordingCourses.recordingId, input.recordingId)).limit(1),
      [] as Array<{ courseId: number }>,
    );
    const shares = await db
      .select()
      .from(groupShares)
      .where(
        and(
          inArray(groupShares.groupId, groups.map(group => group.id)),
          link
            ? or(and(eq(groupShares.itemType, "recording"), eq(groupShares.itemId, input.recordingId)), and(eq(groupShares.itemType, "course"), eq(groupShares.itemId, link.courseId)))
            : and(eq(groupShares.itemType, "recording"), eq(groupShares.itemId, input.recordingId)),
        ),
      );
    return {
      available: true,
      groups: groups.map(group => {
        const direct = shares.find(share => share.groupId === group.id && share.itemType === "recording");
        const viaCourse = shares.find(share => share.groupId === group.id && share.itemType === "course");
        return { id: group.id, name: group.name, shareId: direct?.id ?? null, role: direct?.role ?? null, viaCourseRole: viaCourse?.role ?? null };
      }),
    };
  }),
});
