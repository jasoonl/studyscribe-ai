import { timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { followUpSuggestions, recordings, userNotifications } from "../drizzle/schema";
import { isIsoDate, localIsoDate } from "@shared/actionItems";
import { isMissingTableError } from "./bookmarks";
import { getDb, getFlashcardsByRecordingId, getRecordingById, getTranscriptByRecordingId } from "./db";
import { FOLLOW_UPS_RESPONSE_FORMAT, buildFollowUpMessages, buildReminderMessage, normalizeFollowUps } from "./followUpExtraction";
import { completeJson } from "./llmJson";
import { sendBrowserPush } from "./pushNotifications";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";
import { SINGLE_RECORDING_BUDGET, condenseTranscript } from "./transcriptBudget";

/**
 * Follow-up suggestions after a recording (C7). The table arrives with
 * migration 0021, applied by hand (`npm run db:migrate`). Until then reads
 * return nothing and writes explain themselves, so recording pages keep working.
 */
const NOT_SET_UP = "Follow-ups are not set up on this server yet.";

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
      console.warn("[followUps] table missing; run `npm run db:migrate` to enable follow-ups");
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

export async function deleteFollowUpsForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(followUpSuggestions).where(inArray(followUpSuggestions.recordingId, recordingIds)), undefined);
}

export async function deleteFollowUpsForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(followUpSuggestions).where(eq(followUpSuggestions.userId, userId)), undefined);
}

export async function listFollowUpsForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingTable(
    () => db.select().from(followUpSuggestions).where(eq(followUpSuggestions.userId, userId)),
    [] as Array<typeof followUpSuggestions.$inferSelect>,
  );
}

const todaySchema = z.string().refine(isIsoDate, "Use a real date").optional();

export const followUpsRouter = router({
  /** One recording's suggestions, soonest first, plus how many flashcards it has (for the practice step). */
  list: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await assertOwnRecording(input.recordingId, ctx.user.id);
    const db = await requireDb();
    const items = await tolerateMissingTable(
      () =>
        db
          .select()
          .from(followUpSuggestions)
          .where(and(eq(followUpSuggestions.recordingId, input.recordingId), eq(followUpSuggestions.userId, ctx.user.id)))
          .orderBy(asc(followUpSuggestions.dueDate), asc(followUpSuggestions.id)),
      null,
    );
    return { available: items !== null, items: items ?? [] };
  }),

  /**
   * Plans the days after the recording. Running it again replaces the open
   * suggestions; ticked-off ones are kept.
   */
  generate: protectedProcedure
    .input(z.object({ recordingId: z.number().int().positive(), today: todaySchema }))
    .mutation(async ({ input, ctx }) => {
      if (!checkTrpcRateLimit(`follow-ups:${ctx.user.id}`, 10 * 60 * 1000, 20)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of requests in a short time. Give it a few minutes." });
      }
      const recording = await assertOwnRecording(input.recordingId, ctx.user.id);
      const transcript = await getTranscriptByRecordingId(input.recordingId);
      if (!transcript?.fullText?.trim()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The transcript is not ready yet." });

      const db = await requireDb();
      // Check the table exists before paying for a model call.
      const existing = await explainMissingTable(() =>
        db.select().from(followUpSuggestions).where(and(eq(followUpSuggestions.recordingId, recording.id), eq(followUpSuggestions.userId, ctx.user.id))),
      );

      const flashcards = await getFlashcardsByRecordingId(recording.id);
      const condensed = condenseTranscript({ segments: transcript.segments, fullText: transcript.fullText }, SINGLE_RECORDING_BUDGET);
      const raw = await completeJson({
        messages: buildFollowUpMessages({
          title: recording.title,
          audience: recording.audience,
          transcript: condensed.text,
          flashcardCount: flashcards.length,
        }),
        responseFormat: FOLLOW_UPS_RESPONSE_FORMAT,
        maxTokens: 1200,
        what: "follow-up suggestions",
      });
      const today = input.today ?? localIsoDate(new Date());
      const found = normalizeFollowUps(raw, today);
      if (found.length === 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No follow-ups came back. Try again." });

      const open = existing.filter(item => !item.done);
      if (open.length) await db.delete(followUpSuggestions).where(inArray(followUpSuggestions.id, open.map(item => item.id)));
      await db.insert(followUpSuggestions).values(
        found.map(item => ({
          userId: ctx.user.id,
          recordingId: recording.id,
          kind: item.kind,
          title: item.title,
          detail: item.detail,
          dueDate: item.dueDate,
        })),
      );
      return { added: found.length };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), done: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return explainMissingTable(async () => {
        const owned = and(eq(followUpSuggestions.id, input.id), eq(followUpSuggestions.userId, ctx.user.id));
        const [item] = await db.select({ id: followUpSuggestions.id }).from(followUpSuggestions).where(owned).limit(1);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Follow-up not found" });
        await db.update(followUpSuggestions).set({ done: input.done, doneAt: input.done ? new Date() : null }).where(owned);
        return { updated: true };
      });
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    await explainMissingTable(() =>
      db.delete(followUpSuggestions).where(and(eq(followUpSuggestions.id, input.id), eq(followUpSuggestions.userId, ctx.user.id))),
    );
    return { removed: true };
  }),
});

const MAX_REMINDERS_PER_RUN = 500;

/**
 * Sends one notification per person for follow-ups due today or earlier that
 * have not been reminded yet (in-app, plus browser push if they turned it on).
 * Runs once a day from the Vercel cron below; each item is reminded once.
 */
export async function sendDueFollowUpReminders(today: string): Promise<{ users: number; items: number }> {
  const db = await requireDb();
  const due = await tolerateMissingTable(
    () =>
      db
        .select({ item: followUpSuggestions, recordingTitle: recordings.title })
        .from(followUpSuggestions)
        .innerJoin(recordings, and(eq(recordings.id, followUpSuggestions.recordingId), eq(recordings.isDeleted, 0)))
        .where(and(eq(followUpSuggestions.done, false), isNull(followUpSuggestions.remindedAt), lte(followUpSuggestions.dueDate, today)))
        .orderBy(asc(followUpSuggestions.dueDate))
        .limit(MAX_REMINDERS_PER_RUN),
    [],
  );
  const byUser = new Map<number, typeof due>();
  for (const row of due) byUser.set(row.item.userId, [...(byUser.get(row.item.userId) ?? []), row]);

  for (const [userId, rows] of Array.from(byUser.entries())) {
    const message = buildReminderMessage(rows.map(row => ({ title: row.item.title, recordingTitle: row.recordingTitle })));
    const recordingId = rows[0].item.recordingId;
    try {
      await db.insert(userNotifications).values({ userId, type: "info", title: message.title, message: message.body, recordingId });
      await sendBrowserPush(userId, { title: message.title, body: message.body, url: `/recording/${recordingId}`, tag: "follow-ups" });
    } catch (error) {
      console.error(`[followUps] reminder for user ${userId} failed:`, error instanceof Error ? error.message : error);
    }
    await db.update(followUpSuggestions).set({ remindedAt: new Date() }).where(inArray(followUpSuggestions.id, rows.map(row => row.item.id)));
  }
  return { users: byUser.size, items: due.length };
}

function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Daily reminder run. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. */
export function registerFollowUpCron(app: Express) {
  app.get("/api/cron/follow-up-reminders", async (req: Request, res: Response) => {
    if (!process.env.CRON_SECRET) {
      res.status(503).json({ error: "CRON_SECRET is not set, so reminders are off." });
      return;
    }
    if (!hasCronSecret(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await sendDueFollowUpReminders(new Date().toISOString().slice(0, 10));
      res.json(result);
    } catch (error) {
      console.error("[followUps] reminder run failed:", error);
      res.status(500).json({ error: "Reminder run failed" });
    }
  });
}
