import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { noteTags, recordingTags, recordings, tags } from "../drizzle/schema";
import { getDb, getRecordingById } from "./db";
import { protectedProcedure, router } from "./_core/trpc";
import {
  MAX_TAGS_PER_RECORDING,
  MAX_TAGS_PER_USER,
  diffTagIds,
  hasDuplicateName,
  keepOwnedIds,
  labelSchema,
  courseColorSchema,
  tagInputSchema,
} from "./organizationInput";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function ownTags(userId: number) {
  const db = await requireDb();
  return db.select().from(tags).where(eq(tags.userId, userId));
}

export const tagsRouter = router({
  /** Every tag the person has, with how many live recordings carry it. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await ownTags(ctx.user.id);
    if (rows.length === 0) return [];
    const counts = await db
      .select({ tagId: recordingTags.tagId, total: sql<number>`count(*)` })
      .from(recordingTags)
      .innerJoin(recordings, and(eq(recordings.id, recordingTags.recordingId), eq(recordings.isDeleted, 0)))
      .where(inArray(recordingTags.tagId, rows.map(tag => tag.id)))
      .groupBy(recordingTags.tagId);
    const byTag = new Map(counts.map(row => [row.tagId, Number(row.total)]));
    return rows
      .map(tag => ({ id: tag.id, name: tag.name, color: tag.color, recordingCount: byTag.get(tag.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  create: protectedProcedure.input(tagInputSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const existing = await ownTags(ctx.user.id);
    const duplicate = existing.find(tag => hasDuplicateName([tag], input.name));
    if (duplicate) return { id: duplicate.id, created: false as const };
    if (existing.length >= MAX_TAGS_PER_USER) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `You can have up to ${MAX_TAGS_PER_USER} tags. Remove one you no longer use.` });
    }
    const [result] = await db.insert(tags).values({ userId: ctx.user.id, name: input.name, color: input.color ?? "blue" });
    return { id: Number((result as any).insertId), created: true as const };
  }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), name: labelSchema(40).optional(), color: courseColorSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const existing = await ownTags(ctx.user.id);
      const tag = existing.find(row => row.id === input.id);
      if (!tag) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
      if (input.name !== undefined && hasDuplicateName(existing, input.name, tag.id)) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a tag with that name." });
      }
      const changes: Partial<typeof tags.$inferInsert> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.color !== undefined) changes.color = input.color;
      if (Object.keys(changes).length > 0) {
        await db.update(tags).set(changes).where(and(eq(tags.id, tag.id), eq(tags.userId, ctx.user.id)));
      }
      return { id: tag.id };
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const tag = (await ownTags(ctx.user.id)).find(row => row.id === input.id);
    if (!tag) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
    await db.delete(recordingTags).where(eq(recordingTags.tagId, tag.id));
    await db.delete(noteTags).where(eq(noteTags.tagId, tag.id));
    await db.delete(tags).where(and(eq(tags.id, tag.id), eq(tags.userId, ctx.user.id)));
    return { removed: true };
  }),

  /** Replaces the full set of tags on a recording. */
  setForRecording: protectedProcedure
    .input(z.object({ recordingId: z.number().int().positive(), tagIds: z.array(z.number().int().positive()).max(MAX_TAGS_PER_RECORDING) }))
    .mutation(async ({ ctx, input }) => {
      const recording = await getRecordingById(input.recordingId);
      if (!recording || recording.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });

      const db = await requireDb();
      const owned = await ownTags(ctx.user.id);
      const wanted = keepOwnedIds(input.tagIds, owned.map(tag => tag.id));
      const ownedIds = new Set(owned.map(tag => tag.id));
      const currentRows = await db.select().from(recordingTags).where(eq(recordingTags.recordingId, input.recordingId));
      const current = currentRows.map(row => row.tagId).filter(id => ownedIds.has(id));
      const { add, remove } = diffTagIds(current, wanted);

      if (remove.length > 0) {
        await db.delete(recordingTags).where(and(eq(recordingTags.recordingId, input.recordingId), inArray(recordingTags.tagId, remove)));
      }
      if (add.length > 0) {
        await db.insert(recordingTags).values(add.map(tagId => ({ recordingId: input.recordingId, tagId })));
      }
      return { tagIds: wanted };
    }),
});
