import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { courses, examPacks, recordings, transcripts } from "../drizzle/schema";
import { isMissingTableError } from "./bookmarks";
import { recordingIdsInCourse } from "./courses";
import { getDb } from "./db";
import { completeJson, completeText } from "./llmJson";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";
import {
  MAX_PACK_RECORDINGS,
  PACK_QUIZ_RESPONSE_FORMAT,
  buildGuideMessages,
  buildPackSources,
  buildQuizMessages,
  defaultPackTitle,
  normalizeQuizQuestions,
  scoreQuiz,
  type PackQuestion,
} from "./examPackBuilder";

/**
 * Exam packs (C8): one study guide and one practice quiz across several
 * recordings. Each is a separate request with a bounded amount of transcript,
 * so neither comes near the function time limit. The examPacks table arrives
 * with migration 0020 (`npm run db:migrate`); until then the list is empty and
 * creating one explains why it cannot.
 */
const NOT_SET_UP = "Exam packs are not set up on this server yet.";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function explainMissingTable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_SET_UP });
    throw error;
  }
}

async function tolerateMissingTable<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) return fallback;
    throw error;
  }
}

function limit(userId: number) {
  if (!checkTrpcRateLimit(`exam-pack:${userId}`, 10 * 60 * 1000, 12)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of exam packs in a short time. Give it a few minutes." });
  }
}

/** The person's own, not-trashed recordings with finished transcripts, among `ids`. */
async function loadSources(userId: number, ids: number[]) {
  if (ids.length === 0) return [];
  const db = await requireDb();
  return db
    .select({
      recordingId: recordings.id,
      title: recordings.title,
      audience: recordings.audience,
      createdAt: recordings.createdAt,
      fullText: transcripts.fullText,
      segments: transcripts.segments,
    })
    .from(recordings)
    .innerJoin(transcripts, eq(transcripts.recordingId, recordings.id))
    .where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0), inArray(recordings.id, ids), eq(transcripts.status, "completed")));
}

async function getOwnPack(id: number, userId: number) {
  const db = await requireDb();
  const [pack] = await explainMissingTable(() => db.select().from(examPacks).where(and(eq(examPacks.id, id), eq(examPacks.userId, userId))).limit(1));
  if (!pack) throw new TRPCError({ code: "NOT_FOUND", message: "Exam pack not found" });
  return pack;
}

function packIds(pack: { recordingIds: unknown }): number[] {
  return Array.isArray(pack.recordingIds) ? pack.recordingIds.filter((id): id is number => Number.isInteger(id)) : [];
}

/** A pack is built from its recordings' text, so it goes when any of them is permanently deleted. */
export async function deleteExamPacksForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  const owners = await db.selectDistinct({ userId: recordings.userId }).from(recordings).where(inArray(recordings.id, recordingIds));
  if (owners.length === 0) return;
  await tolerateMissingTable(async () => {
    const packs = await db.select({ id: examPacks.id, recordingIds: examPacks.recordingIds }).from(examPacks).where(inArray(examPacks.userId, owners.map(owner => owner.userId)));
    const purged = new Set(recordingIds);
    const affected = packs.filter(pack => packIds(pack).some(id => purged.has(id))).map(pack => pack.id);
    if (affected.length) await db.delete(examPacks).where(inArray(examPacks.id, affected));
  }, undefined);
}

export async function deleteExamPacksForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(examPacks).where(eq(examPacks.userId, userId)), undefined);
}

export async function exportExamPacksForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingTable(() => db.select().from(examPacks).where(eq(examPacks.userId, userId)), [] as Array<typeof examPacks.$inferSelect>);
}

async function generateQuestions(title: string, sources: ReturnType<typeof buildPackSources>): Promise<PackQuestion[]> {
  const raw = await completeJson({
    messages: buildQuizMessages({ title, sources }),
    responseFormat: PACK_QUIZ_RESPONSE_FORMAT,
    maxTokens: 5000,
    what: "the practice exam",
  });
  const questions = normalizeQuizQuestions(raw, sources);
  if (questions.length < 3) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The practice exam came back too short. Try again." });
  return questions;
}

export const examPacksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await tolerateMissingTable(
      () =>
        db
          .select({
            id: examPacks.id,
            title: examPacks.title,
            courseId: examPacks.courseId,
            recordingIds: examPacks.recordingIds,
            hasGuide: sql<number>`${examPacks.guide} is not null`,
            questions: examPacks.questions,
            lastScore: examPacks.lastScore,
            attempts: examPacks.attempts,
            createdAt: examPacks.createdAt,
          })
          .from(examPacks)
          .where(eq(examPacks.userId, ctx.user.id))
          .orderBy(desc(examPacks.createdAt)),
      null,
    );
    if (rows === null) return { available: false, packs: [] };
    return {
      available: true,
      packs: rows.map(({ questions, hasGuide, recordingIds, ...rest }) => ({
        ...rest,
        recordingCount: packIds({ recordingIds }).length,
        hasGuide: Boolean(Number(hasGuide)),
        questionCount: Array.isArray(questions) ? questions.length : 0,
      })),
    };
  }),

  get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const pack = await getOwnPack(input.id, ctx.user.id);
    const ids = packIds(pack);
    const db = await requireDb();
    const titles = ids.length
      ? await db.select({ id: recordings.id, title: recordings.title, isDeleted: recordings.isDeleted }).from(recordings).where(and(eq(recordings.userId, ctx.user.id), inArray(recordings.id, ids)))
      : [];
    const byId = new Map(titles.map(row => [row.id, row]));
    return {
      ...pack,
      sources: ids.map(id => ({ id, title: byId.get(id)?.title ?? "Deleted recording", available: !!byId.get(id) && !byId.get(id)!.isDeleted })),
    };
  }),

  /**
   * Makes a pack from chosen recordings or a whole course and writes its study
   * guide. The quiz is a second request (`generateQuiz`).
   */
  create: protectedProcedure
    .input(z.object({
      recordingIds: z.array(z.number().int().positive()).max(MAX_PACK_RECORDINGS * 4).optional(),
      courseId: z.number().int().positive().optional(),
      title: z.string().trim().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      limit(ctx.user.id);
      const db = await requireDb();
      await explainMissingTable(() => db.select({ id: examPacks.id }).from(examPacks).where(eq(examPacks.userId, ctx.user.id)).limit(1));

      let courseName: string | null = null;
      let requested = input.recordingIds ?? [];
      if (input.courseId !== undefined) {
        const [course] = await db.select().from(courses).where(and(eq(courses.id, input.courseId), eq(courses.userId, ctx.user.id))).limit(1);
        if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
        courseName = course.name;
        if (requested.length === 0) requested = await recordingIdsInCourse(ctx.user.id, course.id);
      }
      const unique = Array.from(new Set(requested));
      if (unique.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick at least one recording." });

      const found = await loadSources(ctx.user.id, unique);
      if (found.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "None of those recordings has a finished transcript yet." });
      // A course can hold more than fits: keep the most recent ones.
      const chosen = [...found].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, MAX_PACK_RECORDINGS);

      const title = input.title?.trim() || defaultPackTitle(courseName, chosen.length, new Date());
      const sources = buildPackSources(chosen);
      const meeting = chosen.every(row => row.audience === "professional");
      const guide = await completeText({ messages: buildGuideMessages({ title, sources, meeting }), maxTokens: 4000, what: "the study guide" });

      const [result] = await db.insert(examPacks).values({
        userId: ctx.user.id,
        title,
        courseId: input.courseId ?? null,
        recordingIds: sources.map(source => source.recordingId),
        guide,
      });
      return {
        id: Number((result as { insertId?: number }).insertId),
        used: chosen.length,
        skipped: unique.length - chosen.length,
      };
    }),

  generateQuiz: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    limit(ctx.user.id);
    const pack = await getOwnPack(input.id, ctx.user.id);
    const found = await loadSources(ctx.user.id, packIds(pack));
    if (found.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The recordings in this pack are no longer available." });
    const questions = await generateQuestions(pack.title, buildPackSources(found));
    const db = await requireDb();
    await db.update(examPacks).set({ questions, lastScore: null, attempts: 0, lastAttemptAt: null }).where(eq(examPacks.id, pack.id));
    return { questionCount: questions.length };
  }),

  submitAttempt: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), answers: z.record(z.string().max(20), z.string().max(2000)) }))
    .mutation(async ({ ctx, input }) => {
      const pack = await getOwnPack(input.id, ctx.user.id);
      const questions = Array.isArray(pack.questions) ? pack.questions : [];
      if (questions.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This pack has no practice exam yet." });
      const result = scoreQuiz(questions, input.answers);
      const db = await requireDb();
      await db
        .update(examPacks)
        .set({ lastScore: result.score, attempts: sql`${examPacks.attempts} + 1`, lastAttemptAt: new Date() })
        .where(eq(examPacks.id, pack.id));
      return result;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1, "Give it a name").max(200) }))
    .mutation(async ({ ctx, input }) => {
      const pack = await getOwnPack(input.id, ctx.user.id);
      const db = await requireDb();
      await db.update(examPacks).set({ title: input.title }).where(eq(examPacks.id, pack.id));
      return { id: pack.id };
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await explainMissingTable(() => db.delete(examPacks).where(and(eq(examPacks.id, input.id), eq(examPacks.userId, ctx.user.id))));
    return { removed: true };
  }),
});
