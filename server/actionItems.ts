import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { actionItems, recordings } from "../drizzle/schema";
import { ACTION_ITEM_KINDS, MAX_ACTION_ITEM_TEXT, isIsoDate, localIsoDate } from "@shared/actionItems";
import { isMissingTableError } from "./bookmarks";
import { getCourseAssignments } from "./courses";
import { getDb, getRecordingById, getTranscriptByRecordingId } from "./db";
import { completeJson } from "./llmJson";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";
import {
  ACTION_ITEMS_RESPONSE_FORMAT,
  MAX_ACTION_ITEMS,
  actionItemKey,
  buildActionItemsMessages,
  normalizeExtractedActionItems,
} from "./studyExtraction";
import { SINGLE_RECORDING_BUDGET, condenseTranscript } from "./transcriptBudget";

/**
 * Tasks, assignments and deadlines (C3). The actionItems table arrives with
 * migration 0020, applied by hand (`npm run db:migrate`). Until then reads
 * return nothing and writes explain themselves, so recording pages keep working.
 */
const NOT_SET_UP = "Tasks are not set up on this server yet.";
const MAX_ITEMS_PER_RECORDING = 60;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function tolerateMissingTable<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[actionItems] table missing; run `npm run db:migrate` to enable tasks");
      return fallback;
    }
    throw error;
  }
}

async function explainMissingTable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_SET_UP });
    throw error;
  }
}

async function assertOwnRecording(recordingId: number, userId: number) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
  return recording;
}

export async function deleteActionItemsForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(actionItems).where(inArray(actionItems.recordingId, recordingIds)), undefined);
}

export async function deleteActionItemsForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(actionItems).where(eq(actionItems.userId, userId)), undefined);
}

export async function listActionItemsForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingTable(() => db.select().from(actionItems).where(eq(actionItems.userId, userId)), [] as Array<typeof actionItems.$inferSelect>);
}

const dueDateSchema = z
  .string()
  .refine(isIsoDate, "Use a real date")
  .nullable();

const itemTextSchema = z.string().transform(value => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "Write the task").max(MAX_ACTION_ITEM_TEXT));

export const actionItemsRouter = router({
  /** One recording's items, oldest mention first. */
  list: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await assertOwnRecording(input.recordingId, ctx.user.id);
    const db = await requireDb();
    const items = await tolerateMissingTable(
      () =>
        db
          .select()
          .from(actionItems)
          .where(and(eq(actionItems.recordingId, input.recordingId), eq(actionItems.userId, ctx.user.id)))
          .orderBy(asc(actionItems.atSeconds), asc(actionItems.id)),
      null,
    );
    return { available: items !== null, items: items ?? [] };
  }),

  /** Every open and done item across the library (trashed recordings left out), with where each came from. */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await tolerateMissingTable(
      () =>
        db
          .select({
            item: actionItems,
            recordingTitle: recordings.title,
          })
          .from(actionItems)
          .innerJoin(recordings, and(eq(recordings.id, actionItems.recordingId), eq(recordings.isDeleted, 0)))
          .where(eq(actionItems.userId, ctx.user.id)),
      null,
    );
    if (rows === null) return { available: false, items: [] };
    const courses = await getCourseAssignments(ctx.user.id, Array.from(new Set(rows.map(row => row.item.recordingId))));
    return {
      available: true,
      items: rows.map(row => ({ ...row.item, recordingTitle: row.recordingTitle, courseId: courses.get(row.item.recordingId) ?? null })),
    };
  }),

  /**
   * Reads the transcript for tasks and deadlines. Running it again replaces
   * the open items it found last time; items already ticked off or added by
   * hand are kept, and a new item matching one of those is not added twice.
   */
  extract: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    if (!checkTrpcRateLimit(`action-items:${ctx.user.id}`, 10 * 60 * 1000, 20)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of requests in a short time. Give it a few minutes." });
    }
    const recording = await assertOwnRecording(input.recordingId, ctx.user.id);
    const transcript = await getTranscriptByRecordingId(input.recordingId);
    if (!transcript?.fullText?.trim()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The transcript is not ready yet." });

    const db = await requireDb();
    // Check the table exists before paying for a model call.
    const existing = await explainMissingTable(() =>
      db.select().from(actionItems).where(and(eq(actionItems.recordingId, recording.id), eq(actionItems.userId, ctx.user.id))),
    );

    const recordedOn = localIsoDate(new Date(recording.createdAt));
    const condensed = condenseTranscript({ segments: transcript.segments, fullText: transcript.fullText }, SINGLE_RECORDING_BUDGET);
    const raw = await completeJson({
      messages: buildActionItemsMessages({
        title: recording.title,
        audience: recording.audience,
        recordedOn,
        transcript: condensed.text,
        timestamped: condensed.timestamped,
      }),
      responseFormat: ACTION_ITEMS_RESPONSE_FORMAT,
      maxTokens: 2500,
      what: "the task list",
    });
    const found = normalizeExtractedActionItems(raw, { recordedOn, durationSeconds: recording.duration || null });

    const replaceable = existing.filter(item => item.source === "extracted" && !item.done);
    const kept = existing.filter(item => !replaceable.includes(item));
    const keptKeys = new Set(kept.map(item => actionItemKey(item.text)));
    const fresh = found.filter(item => !keptKeys.has(actionItemKey(item.text))).slice(0, Math.max(0, MAX_ITEMS_PER_RECORDING - kept.length));

    if (replaceable.length) await db.delete(actionItems).where(inArray(actionItems.id, replaceable.map(item => item.id)));
    if (fresh.length) {
      await db.insert(actionItems).values(
        fresh.map(item => ({
          userId: ctx.user.id,
          recordingId: recording.id,
          text: item.text,
          kind: item.kind,
          owner: item.owner,
          dueDate: item.dueDate,
          dueText: item.dueText,
          atSeconds: item.atSeconds,
          source: "extracted" as const,
        })),
      );
    }
    return { found: found.length, added: fresh.length, limit: MAX_ACTION_ITEMS };
  }),

  add: protectedProcedure
    .input(z.object({
      recordingId: z.number().int().positive(),
      text: itemTextSchema,
      kind: z.enum(ACTION_ITEM_KINDS).default("task"),
      dueDate: dueDateSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertOwnRecording(input.recordingId, ctx.user.id);
      const db = await requireDb();
      return explainMissingTable(async () => {
        const count = await db.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.recordingId, input.recordingId));
        if (count.length >= MAX_ITEMS_PER_RECORDING) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `A recording can hold up to ${MAX_ITEMS_PER_RECORDING} tasks.` });
        }
        await db.insert(actionItems).values({
          userId: ctx.user.id,
          recordingId: input.recordingId,
          text: input.text,
          kind: input.kind,
          dueDate: input.dueDate ?? null,
          source: "manual",
        });
        return { added: true };
      });
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      done: z.boolean().optional(),
      text: itemTextSchema.optional(),
      dueDate: dueDateSchema.optional(),
      kind: z.enum(ACTION_ITEM_KINDS).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return explainMissingTable(async () => {
        const changes: Partial<typeof actionItems.$inferInsert> = {};
        if (input.done !== undefined) {
          changes.done = input.done;
          changes.doneAt = input.done ? new Date() : null;
        }
        if (input.text !== undefined) changes.text = input.text;
        if (input.kind !== undefined) changes.kind = input.kind;
        if (input.dueDate !== undefined) {
          changes.dueDate = input.dueDate;
          // A date the person set is no longer "how it was said".
          changes.dueText = null;
        }
        const owned = and(eq(actionItems.id, input.id), eq(actionItems.userId, ctx.user.id));
        const [item] = await db.select({ id: actionItems.id }).from(actionItems).where(owned).limit(1);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        if (Object.keys(changes).length === 0) return { updated: false };
        await db.update(actionItems).set(changes).where(owned);
        return { updated: true };
      });
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    await explainMissingTable(() => db.delete(actionItems).where(and(eq(actionItems.id, input.id), eq(actionItems.userId, ctx.user.id))));
    return { removed: true };
  }),
});
