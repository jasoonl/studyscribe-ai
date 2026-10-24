import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { examPacks, practiceSessions, quizAttempts, quizzes, recordingCourses } from "../drizzle/schema";
import { getDb } from "./db";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { readQuestions, type SessionQuestion } from "./practiceBuilder";

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

/** What a quiz, exam pack or practice session is, for the people who ask about its answers. */
export const originInput = z.union([
  z.object({ quizId: z.number().int().positive() }).strict(),
  z.object({ packId: z.number().int().positive() }).strict(),
  z.object({ sessionId: z.number().int().positive() }).strict(),
]);
export type Origin = z.infer<typeof originInput>;

export type ResolvedOrigin = {
  title: string;
  questions: SessionQuestion[];
  /** What the person answered in the attempt; a missing key is an unanswered question. */
  answers: Record<string, string>;
  recordingIds: number[];
  courseId: number | null;
  /** Names one attempt, for the per-attempt explanation cap and the usage charge. */
  attemptKey: string;
  quizId: number | null;
  packId: number | null;
  /** Set when the origin is (or, for a pack, resolves to) a practice session. */
  sessionId: number | null;
};

export function isDuplicateKey(error: unknown) {
  for (let current: any = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current.code === "ER_DUP_ENTRY" || current.errno === 1062) return true;
  }
  return false;
}

/** Rows changed by an update, across the driver's result shapes. */
export function affectedRows(result: unknown): number {
  const head = Array.isArray(result) ? result[0] : result;
  return Number((head as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

export async function courseOfRecording(db: Db, userId: number, recordingId: number | undefined): Promise<number | null> {
  if (!recordingId) return null;
  const rows = await tolerateMissingSchema(
    "courses",
    () => db.select({ courseId: recordingCourses.courseId }).from(recordingCourses).where(and(eq(recordingCourses.recordingId, recordingId), eq(recordingCourses.userId, userId))).limit(1),
    [] as Array<{ courseId: number }>,
  );
  return rows[0]?.courseId ?? null;
}

function idsOfSession(session: { recordingIds: unknown }, questions: SessionQuestion[]): number[] {
  const stored = Array.isArray(session.recordingIds) ? session.recordingIds.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  const fromQuestions = questions.map(question => question.recordingId).filter((id): id is number => !!id);
  return Array.from(new Set([...stored, ...fromQuestions]));
}

export async function fromSession(db: Db, userId: number, session: typeof practiceSessions.$inferSelect): Promise<ResolvedOrigin> {
  const questions = readQuestions(session.questions);
  const recordingIds = idsOfSession(session, questions);
  return {
    title: session.title,
    questions,
    answers: (session.answers ?? {}) as Record<string, string>,
    recordingIds,
    courseId: session.courseId ?? (await courseOfRecording(db, userId, recordingIds[0])),
    attemptKey: `session:${session.id}`,
    quizId: session.quizId ?? null,
    packId: session.packId ?? null,
    sessionId: session.id,
  };
}

/**
 * Finds the quiz, pack or session, checks it is the person's own (anything
 * else is NOT_FOUND, so ids cannot be probed) and that an attempt has been
 * made: before that there is nothing to explain, and nothing to hand out as a hint.
 * A pack resolves to its latest submitted practice session, because pack
 * attempts are recorded as sessions.
 */
export async function resolveOrigin(userId: number, origin: Origin): Promise<ResolvedOrigin> {
  const db = await requireDb();

  if ("quizId" in origin) {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, origin.quizId)).limit(1);
    if (!quiz || quiz.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Quiz not found" });
    const [attempt] = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, userId)))
      .orderBy(desc(quizAttempts.createdAt), desc(quizAttempts.id))
      .limit(1);
    if (!attempt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Take the quiz first." });
    return {
      title: quiz.title,
      questions: readQuestions(quiz.questions, quiz.recordingId),
      answers: (attempt.answers ?? {}) as Record<string, string>,
      recordingIds: [quiz.recordingId],
      courseId: await courseOfRecording(db, userId, quiz.recordingId),
      attemptKey: `quiz:${attempt.id}`,
      quizId: quiz.id,
      packId: null,
      sessionId: null,
    };
  }

  if ("packId" in origin) {
    const [pack] = await db.select({ id: examPacks.id }).from(examPacks).where(and(eq(examPacks.id, origin.packId), eq(examPacks.userId, userId))).limit(1);
    if (!pack) throw new TRPCError({ code: "NOT_FOUND", message: "Exam pack not found" });
    const [submitted] = await explainMissingSchema("Practice exams", () =>
      db
        .select()
        .from(practiceSessions)
        .where(and(eq(practiceSessions.userId, userId), eq(practiceSessions.packId, pack.id), eq(practiceSessions.scope, "pack"), isNotNull(practiceSessions.submittedAt)))
        .orderBy(desc(practiceSessions.submittedAt), desc(practiceSessions.id))
        .limit(1),
    );
    if (!submitted) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Take the practice exam first." });
    return fromSession(db, userId, submitted);
  }

  const [session] = await explainMissingSchema("Practice exams", () => db.select().from(practiceSessions).where(and(eq(practiceSessions.id, origin.sessionId), eq(practiceSessions.userId, userId))).limit(1));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
  if (!session.submittedAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Finish the practice first. Explanations come after you submit." });
  return fromSession(db, userId, session);
}
