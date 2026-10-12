import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { transcriptAnnotations, users } from "../drizzle/schema";
import { MAX_COMMENT_CHARS, MAX_QUOTE_CHARS, buildThreads, canDelete, canResolve, validateAnchor } from "@shared/annotations";
import { canSeeAnnotations, roleAllows } from "@shared/sharing";
import { notifyUser } from "./collabNotifications";
import { getDb, getTranscriptByRecordingId } from "./db";
import { getRecordingAccess, requireRecordingAccess } from "./recordingAccess";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Comments and highlights on transcript lines (B7). Visible to the owner and to
 * anyone with comment or edit access (direct or through a group); view-only
 * recipients and public links never see them. The table arrives with
 * migration 0022; before it runs, lists are empty and writes explain why.
 */

const FEATURE = "Comments";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

type AnnotationRow = typeof transcriptAnnotations.$inferSelect;

export async function authorsById(ids: number[]) {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map<number, string>();
  const db = await requireDb();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map(row => [row.id, row.name?.trim() || row.email.split("@")[0]]));
}

export async function deleteAnnotationsForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingSchema("annotations", () => db.delete(transcriptAnnotations).where(inArray(transcriptAnnotations.recordingId, recordingIds)), undefined);
}

/** Removes everything a person wrote, and replies left hanging under their deleted threads. */
export async function deleteAnnotationsByAuthor(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema(
    "annotations",
    async () => {
      const roots = await db.select({ id: transcriptAnnotations.id }).from(transcriptAnnotations).where(eq(transcriptAnnotations.authorId, userId));
      const rootIds = roots.map(row => row.id);
      if (rootIds.length) await db.delete(transcriptAnnotations).where(inArray(transcriptAnnotations.parentId, rootIds));
      await db.delete(transcriptAnnotations).where(eq(transcriptAnnotations.authorId, userId));
    },
    undefined,
  );
}

export async function exportAnnotationsByAuthor(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema("annotations", () => db.select().from(transcriptAnnotations).where(eq(transcriptAnnotations.authorId, userId)), [] as AnnotationRow[]);
}

/** Latest comments on any of these recordings, for a group feed. */
export async function recentCommentsOn(recordingIds: number[], limit = 10) {
  if (recordingIds.length === 0) return [];
  const db = await requireDb();
  const rows = await tolerateMissingSchema(
    "annotations",
    () =>
      db
        .select()
        .from(transcriptAnnotations)
        .where(and(inArray(transcriptAnnotations.recordingId, recordingIds), eq(transcriptAnnotations.kind, "comment")))
        .orderBy(desc(transcriptAnnotations.createdAt))
        .limit(limit),
    [] as AnnotationRow[],
  );
  const names = await authorsById(rows.map(row => row.authorId));
  return rows.map(row => ({
    id: row.id,
    recordingId: row.recordingId,
    authorName: names.get(row.authorId) ?? "Someone",
    body: row.body ?? "",
    quote: row.quote,
    isReply: row.parentId !== null,
    createdAt: row.createdAt,
  }));
}

async function loadAnnotation(id: number) {
  const db = await requireDb();
  const rows = await explainMissingSchema(FEATURE, () => db.select().from(transcriptAnnotations).where(eq(transcriptAnnotations.id, id)).limit(1));
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That comment no longer exists." });
  return row;
}

function rateLimit(userId: number) {
  if (!checkTrpcRateLimit(`annotations:${userId}`, 60 * 1000, 30)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of comments in a minute. Wait a moment and try again." });
  }
}

const recordingLink = (role: string, recordingId: number) => (role === "owner" ? `/recording/${recordingId}` : `/shared-with-me/${recordingId}`);

export const annotationsRouter = router({
  list: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const access = await requireRecordingAccess(input.recordingId, ctx.user.id, "view");
    const permissions = {
      canSee: canSeeAnnotations(access.role),
      canComment: roleAllows(access.role, "comment"),
      canModerate: access.role === "owner",
      canResolveAny: roleAllows(access.role, "edit"),
      role: access.role,
      currentUserId: ctx.user.id,
    };
    if (!permissions.canSee) return { available: true, permissions, threads: [] };
    const db = await requireDb();
    let available = true;
    const rows = await tolerateMissingSchema(
      "annotations",
      () => db.select().from(transcriptAnnotations).where(eq(transcriptAnnotations.recordingId, input.recordingId)),
      null as AnnotationRow[] | null,
    );
    if (rows === null) available = false;
    const names = await authorsById((rows ?? []).map(row => row.authorId));
    const shaped = (rows ?? []).map(row => ({ ...row, authorName: names.get(row.authorId) ?? "Someone" }));
    return { available, permissions, threads: buildThreads(shaped) };
  }),

  create: protectedProcedure
    .input(
      z.object({
        recordingId: z.number().int().positive(),
        segmentIndex: z.number().int().min(0),
        segmentId: z.string().max(64).optional(),
        startOffset: z.number().int().min(0),
        endOffset: z.number().int().min(1),
        quote: z.string().min(1).max(MAX_QUOTE_CHARS + 200),
        kind: z.enum(["highlight", "comment"]),
        body: z.string().trim().max(MAX_COMMENT_CHARS).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      rateLimit(ctx.user.id);
      const access = await requireRecordingAccess(input.recordingId, ctx.user.id, "comment");
      if (input.kind === "comment" && !input.body) throw new TRPCError({ code: "BAD_REQUEST", message: "Write a comment first." });
      const transcript = await getTranscriptByRecordingId(input.recordingId);
      const check = validateAnchor(transcript?.segments ?? null, input);
      if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
      const db = await requireDb();
      await explainMissingSchema(FEATURE, () =>
        db.insert(transcriptAnnotations).values({
          recordingId: input.recordingId,
          authorId: ctx.user.id,
          parentId: null,
          kind: input.kind,
          segmentIndex: check.anchor.segmentIndex,
          segmentId: check.anchor.segmentId ?? null,
          startOffset: check.anchor.startOffset,
          endOffset: check.anchor.endOffset,
          quote: check.anchor.quote,
          body: input.body || null,
        }),
      );
      if (input.kind === "comment" && access.recording.userId !== ctx.user.id) {
        await notifyUser(access.recording.userId, {
          title: "New comment on your transcript",
          message: `${ctx.user.name || ctx.user.email} commented on "${access.recording.title}": ${input.body!.slice(0, 140)}`,
          url: `/recording/${access.recording.id}`,
          recordingId: access.recording.id,
          tag: `comments-${access.recording.id}`,
        });
      }
      return { created: true };
    }),

  reply: protectedProcedure
    .input(z.object({ parentId: z.number().int().positive(), body: z.string().trim().min(1).max(MAX_COMMENT_CHARS) }))
    .mutation(async ({ input, ctx }) => {
      rateLimit(ctx.user.id);
      const parent = await loadAnnotation(input.parentId);
      if (parent.parentId !== null) throw new TRPCError({ code: "BAD_REQUEST", message: "Reply to the thread, not to a reply." });
      const access = await requireRecordingAccess(parent.recordingId, ctx.user.id, "comment");
      const db = await requireDb();
      await db.insert(transcriptAnnotations).values({
        recordingId: parent.recordingId,
        authorId: ctx.user.id,
        parentId: parent.id,
        kind: "comment",
        segmentIndex: parent.segmentIndex,
        segmentId: parent.segmentId,
        startOffset: parent.startOffset,
        endOffset: parent.endOffset,
        quote: parent.quote,
        body: input.body,
      });
      // A reply reopens a resolved thread: someone still has something to say.
      if (parent.resolved) await db.update(transcriptAnnotations).set({ resolved: false, resolvedBy: null, resolvedAt: null }).where(eq(transcriptAnnotations.id, parent.id));
      const recipients = new Set([parent.authorId, access.recording.userId]);
      recipients.delete(ctx.user.id);
      for (const userId of Array.from(recipients)) {
        const role = userId === access.recording.userId ? "owner" : "shared";
        await notifyUser(userId, {
          title: "New reply on a transcript comment",
          message: `${ctx.user.name || ctx.user.email} replied on "${access.recording.title}": ${input.body.slice(0, 140)}`,
          url: recordingLink(role, access.recording.id),
          recordingId: role === "owner" ? access.recording.id : undefined,
          tag: `comments-${access.recording.id}`,
        });
      }
      return { created: true };
    }),

  setResolved: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), resolved: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const row = await loadAnnotation(input.id);
      if (row.parentId !== null) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolve the thread, not a reply." });
      const access = await requireRecordingAccess(row.recordingId, ctx.user.id, "comment");
      if (!canResolve({ userId: ctx.user.id, role: access.role }, row.authorId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the person who started this thread, the owner or an editor can resolve it." });
      }
      const db = await requireDb();
      await db
        .update(transcriptAnnotations)
        .set(input.resolved ? { resolved: true, resolvedBy: ctx.user.id, resolvedAt: new Date() } : { resolved: false, resolvedBy: null, resolvedAt: null })
        .where(eq(transcriptAnnotations.id, row.id));
      return { resolved: input.resolved };
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const row = await loadAnnotation(input.id);
    const access = await getRecordingAccess(row.recordingId, ctx.user.id);
    // Authors can always take back what they wrote, even after losing access.
    const role = access?.role ?? null;
    if (!(row.authorId === ctx.user.id || (role && canDelete({ userId: ctx.user.id, role }, row.authorId)))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author or the recording's owner can delete this." });
    }
    const db = await requireDb();
    await db.delete(transcriptAnnotations).where(or(eq(transcriptAnnotations.id, row.id), eq(transcriptAnnotations.parentId, row.id)));
    return { removed: true };
  }),
});
