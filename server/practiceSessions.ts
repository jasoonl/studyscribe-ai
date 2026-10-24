import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { PRACTICE_GRACE_SECONDS } from "@shared/const";
import { examPacks, practiceSessions, questionExplanations, quizAttempts, quizzes, recordings, transcripts } from "../drizzle/schema";
import { describeAiFailure } from "./aiErrors";
import { buildPassages, extractSearchTerms, type Passage } from "./askRetrieval";
import { loadSourcePassages } from "./ask";
import { recordingIdsInCourse, getOwnCourse } from "./courses";
import { passageKey, selectExplanationPassages } from "./explanationPrompt";
import { deleteExplanationsForAttempts } from "./mistakeExplanations";
import { PACK_QUIZ_RESPONSE_FORMAT } from "./examPackBuilder";
import { completeJson } from "./llmJson";
import { recordQuizStudy } from "./planner";
import {
  buildSimilarMessages, clampTarget, cleanAnswers, mergeSimilar, missedQuestions, missedSnapshot, readGenerated, readQuestions, sampleQuestions, scoreSession, stripAnswers,
  type SessionQuestion,
} from "./practiceBuilder";
import { affectedRows, courseOfRecording, isDuplicateKey, originInput, requireDb, resolveOrigin, type Db } from "./practiceOrigin";
import { EXTRA_TIME_FACTORS, MAX_MINUTES, MIN_MINUTES, acceptsAnswers, deadlineFor, defaultMinutes, secondsUsed, shouldAutoSubmit, timeLimitSeconds } from "./practiceTimer";
import { explainMissingSchema, isSchemaMissingError, tolerateMissingSchema } from "./schemaTolerance";
import { AI_BURST_LIMIT, assertCanGenerate, hasUsage, recordAiGeneration } from "./usage";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";
import { getQuizById } from "./db";

/**
 * Practice sessions (Phase 8): timed practice exams, review runs, "practice
 * what I missed", and the record of exam pack attempts. The server owns the
 * clock and the answers: the browser gets the questions without answers while
 * a session is open, and an unsubmitted session is finished from its saved
 * answers when its time (plus a short grace) has run out, so closing the tab
 * cannot stop the clock. Tables arrive with migration 0035.
 */
const FEATURE = "Practice exams";
const OPEN_KEY = "timed-open";
export const START_LIMIT = { windowMs: 60 * 60 * 1000, max: 10 };
const SIMILAR_CLAIM_MS = 90_000;
const SIMILAR_TIMEOUT_MS = 40_000;
const SIMILAR_CHAR_BUDGET = 12_000;

type SessionRow = typeof practiceSessions.$inferSelect;

const nowSeconds = () => new Date(Math.floor(Date.now() / 1000) * 1000);

async function loadOwned(db: Db, userId: number, id: number): Promise<SessionRow> {
  const [row] = await explainMissingSchema(FEATURE, () => db.select().from(practiceSessions).where(and(eq(practiceSessions.id, id), eq(practiceSessions.userId, userId))).limit(1));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
  return row;
}

export type Outcome = ReturnType<typeof scoreSession> & { autoSubmitted: boolean; secondsUsed: number };

function outcomeOf(session: SessionRow): Outcome {
  const questions = readQuestions(session.questions);
  const scored = scoreSession(questions, (session.answers ?? {}) as Record<string, string>);
  const end = session.submittedAt ?? new Date();
  return { ...scored, autoSubmitted: session.autoSubmitted, secondsUsed: secondsUsed(session.startedAt, end, session.timeLimitSeconds) };
}

/**
 * Closes a session exactly once. The conditional update is the claim: when a
 * parallel request (a late submit, a lazy auto-submit) already closed it, the
 * stored result is returned and nothing is written twice, including the quiz
 * attempt row and the study event.
 */
export async function finalizeSession(
  db: Db,
  session: SessionRow,
  options: { answers: Record<string, string>; auto: boolean; submittedAt: Date; localDate?: string },
): Promise<{ outcome: Outcome; claimed: boolean }> {
  const questions = readQuestions(session.questions);
  const scored = scoreSession(questions, options.answers);
  const quiz = session.scope === "quiz" || session.scope === "missed" ? (session.quizId ? await getQuizById(session.quizId).catch(() => null) : null) : null;
  // A quiz attempt row is only written when the whole quiz was taken, so its ids line up with the quiz.
  const wholeQuiz = session.scope === "quiz" && !!quiz && readQuestions(quiz.questions).length === questions.length;

  let claimed = false;
  await db.transaction(async tx => {
    const result = await tx
      .update(practiceSessions)
      .set({
        submittedAt: options.submittedAt,
        autoSubmitted: options.auto,
        answers: options.answers,
        score: scored.score,
        results: scored.results.map(({ id, correct }) => ({ id, correct })),
        openKey: null,
      })
      .where(and(eq(practiceSessions.id, session.id), isNull(practiceSessions.submittedAt)));
    claimed = affectedRows(result) > 0;
    if (claimed && wholeQuiz) {
      await tx.insert(quizAttempts).values({ quizId: session.quizId!, userId: session.userId, answers: options.answers, score: scored.score, completedAt: options.submittedAt });
    }
  });

  if (!claimed) {
    const [fresh] = await db.select().from(practiceSessions).where(eq(practiceSessions.id, session.id)).limit(1);
    return { outcome: outcomeOf(fresh ?? session), claimed: false };
  }
  if (quiz) await recordQuizStudy({ userId: session.userId, recordingId: quiz.recordingId, quizId: quiz.id, score: scored.score, localDate: options.localDate });
  return {
    outcome: { ...scored, autoSubmitted: options.auto, secondsUsed: secondsUsed(session.startedAt, options.submittedAt, session.timeLimitSeconds) },
    claimed: true,
  };
}

/** Finishes a session whose time has run out, from the answers saved so far. Returns the up-to-date row. */
async function finalizeIfExpired(db: Db, session: SessionRow, now: Date): Promise<SessionRow> {
  if (!shouldAutoSubmit(now, session)) return session;
  await finalizeSession(db, session, {
    answers: cleanAnswers(session.answers, readQuestions(session.questions)),
    auto: true,
    submittedAt: session.deadlineAt ?? now,
  });
  const [fresh] = await db.select().from(practiceSessions).where(eq(practiceSessions.id, session.id)).limit(1);
  return fresh ?? session;
}

async function findOpenTimed(db: Db, userId: number) {
  const [row] = await db.select().from(practiceSessions).where(and(eq(practiceSessions.userId, userId), eq(practiceSessions.openKey, OPEN_KEY))).limit(1);
  return row ?? null;
}

function view(session: SessionRow, now: Date) {
  const questions = readQuestions(session.questions);
  const submitted = !!session.submittedAt;
  return {
    id: session.id,
    mode: session.mode,
    scope: session.scope,
    title: session.title,
    status: submitted ? ("submitted" as const) : ("open" as const),
    questions: stripAnswers(questions),
    answers: cleanAnswers(session.answers, questions),
    deadlineAt: session.deadlineAt,
    serverNow: now,
    timeLimitSeconds: session.timeLimitSeconds,
    extraTime: session.extraTimePercent !== 100 ? session.extraTimePercent / 100 : null,
    ...(submitted ? { result: outcomeOf(session) } : {}),
  };
}

// ------------------------------------------------------------ building a session

type Built = { title: string; questions: SessionQuestion[]; recordingIds: number[]; quizId: number | null; packId: number | null; courseId: number | null };

async function buildPool(db: Db, userId: number, input: { scope: "quiz" | "pack" | "course"; quizId?: number; packId?: number; courseId?: number; questionCount?: number }): Promise<Built> {
  const none = new TRPCError({ code: "PRECONDITION_FAILED", message: "There are no questions to practise with yet. Make a quiz first." });
  if (input.scope === "quiz") {
    if (!input.quizId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a quiz." });
    const quiz = await getQuizById(input.quizId);
    if (!quiz || quiz.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Quiz not found" });
    const all = readQuestions(quiz.questions, quiz.recordingId);
    if (all.length === 0) throw none;
    const count = Math.min(input.questionCount ?? all.length, all.length);
    // Ids stay the quiz's own so that a full run lines up with its attempts.
    const questions = sampleQuestions(all, count, { shuffle: count < all.length, keepIds: true });
    return { title: quiz.title, questions, recordingIds: [quiz.recordingId], quizId: quiz.id, packId: null, courseId: await courseOfRecording(db, userId, quiz.recordingId) };
  }
  if (input.scope === "pack") {
    if (!input.packId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick an exam pack." });
    const [pack] = await db.select().from(examPacks).where(and(eq(examPacks.id, input.packId), eq(examPacks.userId, userId))).limit(1);
    if (!pack) throw new TRPCError({ code: "NOT_FOUND", message: "Exam pack not found" });
    const all = readQuestions(pack.questions);
    if (all.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This pack has no practice exam yet." });
    const count = Math.min(input.questionCount ?? all.length, all.length);
    const ids = Array.isArray(pack.recordingIds) ? pack.recordingIds.filter((id): id is number => Number.isInteger(id)) : [];
    return { title: pack.title, questions: sampleQuestions(all, count, { shuffle: count < all.length, keepIds: true }), recordingIds: ids, quizId: null, packId: pack.id, courseId: pack.courseId ?? null };
  }
  if (!input.courseId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a course." });
  const course = await getOwnCourse(input.courseId, userId);
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  const recordingIds = await recordingIdsInCourse(userId, course.id);
  const quizRows = recordingIds.length ? await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), inArray(quizzes.recordingId, recordingIds))) : [];
  const packRows = await db.select().from(examPacks).where(and(eq(examPacks.userId, userId), eq(examPacks.courseId, course.id)));
  const pool = [
    ...quizRows.flatMap(quiz => readQuestions(quiz.questions, quiz.recordingId)),
    ...packRows.flatMap(pack => readQuestions(pack.questions)),
  ];
  if (pool.length === 0) throw none;
  const questions = sampleQuestions(pool, input.questionCount ?? 20, { shuffle: true });
  const used = Array.from(new Set(questions.map(question => question.recordingId).filter((id): id is number => !!id)));
  return { title: `${course.name} practice`, questions, recordingIds: used, quizId: null, packId: null, courseId: course.id };
}

const startInput = z.object({
  scope: z.enum(["quiz", "pack", "course"]),
  quizId: z.number().int().positive().optional(),
  packId: z.number().int().positive().optional(),
  courseId: z.number().int().positive().optional(),
  mode: z.enum(["timed", "review"]),
  questionCount: z.number().int().min(5).max(40).optional(),
  minutes: z.number().int().min(MIN_MINUTES).max(MAX_MINUTES).optional(),
  extraTime: z.union([z.literal(1), z.literal(1.25), z.literal(1.5)]).optional(),
});

function startResult(session: SessionRow, resumed: boolean) {
  return { sessionId: session.id, resumed, deadlineAt: session.deadlineAt, serverNow: new Date(), timeLimitSeconds: session.timeLimitSeconds };
}

export async function startSession(userId: number, input: z.infer<typeof startInput>) {
  const db = await requireDb();
  return explainMissingSchema(FEATURE, async () => {
    if (input.mode === "timed") {
      const open = await findOpenTimed(db, userId);
      if (open) {
        const fresh = await finalizeIfExpired(db, open, new Date());
        if (!fresh.submittedAt) return startResult(fresh, true);
      }
    }
    if (!checkTrpcRateLimit(`practice-start:${userId}`, START_LIMIT.windowMs, START_LIMIT.max)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of practice exams in an hour. Give it a little while." });
    }
    const built = await buildPool(db, userId, input);
    const timed = input.mode === "timed";
    const startedAt = nowSeconds();
    const limit = timed ? timeLimitSeconds(input.minutes ?? defaultMinutes(built.questions.length), input.extraTime ?? 1) : null;
    const values = {
      userId,
      mode: input.mode,
      scope: input.scope,
      quizId: built.quizId,
      packId: built.packId,
      courseId: built.courseId,
      title: built.title.slice(0, 255),
      questions: built.questions,
      recordingIds: built.recordingIds,
      timeLimitSeconds: limit,
      extraTimePercent: Math.round((input.extraTime ?? 1) * 100),
      openKey: timed ? OPEN_KEY : null,
      startedAt,
      deadlineAt: limit ? deadlineFor(startedAt, limit) : null,
    };
    try {
      const [result] = await db.insert(practiceSessions).values(values);
      const id = Number((result as { insertId?: number }).insertId);
      return { sessionId: id, resumed: false, deadlineAt: values.deadlineAt, serverNow: new Date(), timeLimitSeconds: limit };
    } catch (error) {
      // Two starts at once: the unique open key lets only one in, the other resumes it.
      if (isDuplicateKey(error)) {
        const open = await findOpenTimed(db, userId);
        if (open) return startResult(open, true);
      }
      throw error;
    }
  });
}

// ------------------------------------------------------------ practice what I missed

async function missedFrom(userId: number, input: { origin: z.infer<typeof originInput>; questionCount?: number }) {
  const db = await requireDb();
  return explainMissingSchema(FEATURE, async () => {
    const origin = await resolveOrigin(userId, input.origin);
    const missed = missedQuestions(origin.questions, origin.answers);
    if (missed.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing was missed. There is nothing to practise." });

    const parentSessionId = origin.sessionId;
    // Asking again for the same misses resumes the open run instead of piling up copies.
    const signature = missed.map(question => question.question).sort().join("\u0000");
    const candidates = await db
      .select()
      .from(practiceSessions)
      .where(and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.scope, "missed"),
        isNull(practiceSessions.submittedAt),
        parentSessionId !== null ? eq(practiceSessions.parentSessionId, parentSessionId) : origin.quizId !== null ? and(isNull(practiceSessions.parentSessionId), eq(practiceSessions.quizId, origin.quizId)) : undefined,
      ))
      .orderBy(desc(practiceSessions.createdAt))
      .limit(5);
    const same = candidates.find(candidate => {
      const have = readQuestions(candidate.questions).slice(0, missed.length).map(question => question.question).sort().join("\u0000");
      return have === signature;
    });
    if (same) return { sessionId: same.id };

    const [result] = await db.insert(practiceSessions).values({
      userId,
      mode: "review",
      scope: "missed",
      quizId: origin.quizId,
      packId: origin.packId,
      courseId: origin.courseId,
      parentSessionId,
      title: `Missed questions: ${origin.title}`.slice(0, 255),
      questions: missedSnapshot(missed),
      recordingIds: origin.recordingIds,
      targetCount: clampTarget(input.questionCount, missed.length),
    });
    return { sessionId: Number((result as { insertId?: number }).insertId) };
  });
}

/** The excerpts that look-alike questions are written from: a couple for each missed question, within a character budget. */
async function gatherSimilarPassages(db: Db, userId: number, session: SessionRow, missed: SessionQuestion[]): Promise<Passage[]> {
  const recordingIds = Array.isArray(session.recordingIds) ? session.recordingIds.filter((id): id is number => Number.isInteger(id)).slice(0, 30) : [];
  const recordingPassages = recordingIds.length
    ? (await db
        .select({ recordingId: recordings.id, title: recordings.title, fullText: transcripts.fullText, segments: transcripts.segments })
        .from(recordings)
        .innerJoin(transcripts, eq(transcripts.recordingId, recordings.id))
        .where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0), inArray(recordings.id, recordingIds), eq(transcripts.status, "completed")))
      ).flatMap(row => buildPassages({ recordingId: row.recordingId, title: row.title, fullText: row.fullText ?? "", segments: row.segments as any }))
    : [];
  const chosen: Passage[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const question of missed) {
    const terms = extractSearchTerms(`${question.question} ${question.correctAnswer}`);
    const sources = session.courseId ? await loadSourcePassages(userId, terms, session.courseId) : [];
    for (const passage of selectExplanationPassages([...recordingPassages, ...sources], terms, question.recordingId).slice(0, 2)) {
      const key = passageKey(passage);
      if (seen.has(key) || chars + passage.text.length > SIMILAR_CHAR_BUDGET) continue;
      seen.add(key);
      chosen.push(passage);
      chars += passage.text.length;
    }
  }
  return chosen;
}

export async function addSimilarQuestions(user: { id: number; role?: string | null; loginMethod?: string | null; emailVerified?: number | null }, sessionId: number): Promise<{ added: number }> {
  const db = await requireDb();
  const userId = user.id;
  return explainMissingSchema(FEATURE, async () => {
    const session = await loadOwned(db, userId, sessionId);
    if (session.scope !== "missed") throw new TRPCError({ code: "BAD_REQUEST", message: "Similar questions can only be added to a missed-questions practice." });
    if (session.submittedAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That practice is already finished." });
    if (session.similarAddedAt) return { added: 0 };

    const existing = readQuestions(session.questions);
    const target = session.targetCount ?? existing.length;
    if (existing.length >= target) return { added: 0 };

    // One request at a time per session: a stale claim (a request that died) expires.
    const claimedAt = new Date();
    const claim = await db
      .update(practiceSessions)
      .set({ similarClaimedAt: claimedAt })
      .where(and(
        eq(practiceSessions.id, session.id),
        isNull(practiceSessions.similarAddedAt),
        isNull(practiceSessions.submittedAt),
        or(isNull(practiceSessions.similarClaimedAt), lt(practiceSessions.similarClaimedAt, new Date(claimedAt.getTime() - SIMILAR_CLAIM_MS))),
      ));
    if (affectedRows(claim) === 0) return { added: 0 };

    const release = () => db.update(practiceSessions).set({ similarClaimedAt: null }).where(and(eq(practiceSessions.id, session.id), isNull(practiceSessions.similarAddedAt))).catch(() => undefined);
    try {
      const passages = await gatherSimilarPassages(db, userId, session, existing);
      if (passages.length === 0) {
        // Nothing of theirs to write from: no model call, no charge. The verbatim run stands.
        await db.update(practiceSessions).set({ similarAddedAt: new Date() }).where(eq(practiceSessions.id, session.id));
        return { added: 0 };
      }

      const usageKey = `similar:${session.id}`;
      if (user.role !== "admin" && !checkTrpcRateLimit(`ai-burst:${userId}`, AI_BURST_LIMIT.windowMs, AI_BURST_LIMIT.max)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of AI requests in a few minutes. Wait a little and try again." });
      }
      if (!(await hasUsage(usageKey))) await assertCanGenerate(user);

      let raw: unknown;
      try {
        raw = await completeJson({
          messages: buildSimilarMessages(existing, passages, target - existing.length),
          responseFormat: PACK_QUIZ_RESPONSE_FORMAT,
          maxTokens: 3000,
          what: "the extra practice questions",
          timeoutMs: SIMILAR_TIMEOUT_MS,
        });
      } catch (error) {
        const failure = describeAiFailure(error);
        if (failure) throw new TRPCError({ code: failure.code, message: failure.message, cause: error });
        throw error;
      }
      const { questions, added } = mergeSimilar(existing, readGenerated(raw, passages), target);
      if (added === 0) {
        // Nothing usable came back: no charge, and the person can try again.
        await release();
        return { added: 0 };
      }
      const saved = await db
        .update(practiceSessions)
        .set({ questions, similarAddedAt: new Date() })
        .where(and(eq(practiceSessions.id, session.id), isNull(practiceSessions.submittedAt)));
      // Submitted in the meantime: the questions are not added.
      if (affectedRows(saved) === 0) return { added: 0 };
      await recordAiGeneration(userId, usageKey);
      return { added };
    } catch (error) {
      await release();
      throw error;
    }
  });
}

// ------------------------------------------------------------ router

export const practiceRouter = router({
  /** Whether practice sessions and explanations are set up on this server (migration 0035). */
  capabilities: protectedProcedure.query(async () => {
    const db = await requireDb();
    const probe = async (work: () => Promise<unknown>) => (await tolerateMissingSchema(FEATURE, async () => (await work(), true), false)) as boolean;
    const available = await probe(() => db.select({ id: practiceSessions.id }).from(practiceSessions).limit(1));
    const explanations = available && (await probe(() => db.select({ id: questionExplanations.id }).from(questionExplanations).limit(1)));
    return { available, explanations };
  }),

  start: protectedProcedure.input(startInput).mutation(({ ctx, input }) => startSession(ctx.user.id, input)),

  get: protectedProcedure.input(z.object({ sessionId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const now = new Date();
    const session = await finalizeIfExpired(db, await loadOwned(db, ctx.user.id, input.sessionId), now);
    return view(session, now);
  }),

  saveAnswers: protectedProcedure
    .input(z.object({ sessionId: z.number().int().positive(), answers: z.record(z.string().max(20), z.string().max(2000)) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const now = new Date();
      const session = await finalizeIfExpired(db, await loadOwned(db, ctx.user.id, input.sessionId), now);
      if (session.submittedAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Time is up. Your answers were submitted." });
      if (!acceptsAnswers(now, session.deadlineAt)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Time is up." });
      const questions = readQuestions(session.questions);
      const merged = { ...cleanAnswers(session.answers, questions), ...cleanAnswers(input.answers, questions) };
      await db.update(practiceSessions).set({ answers: merged }).where(and(eq(practiceSessions.id, session.id), isNull(practiceSessions.submittedAt)));
      return { savedAt: now };
    }),

  submit: protectedProcedure
    .input(z.object({ sessionId: z.number().int().positive(), answers: z.record(z.string().max(20), z.string().max(2000)), localDate: z.string().max(10).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const now = new Date();
      const session = await loadOwned(db, ctx.user.id, input.sessionId);
      // Submitting twice returns the first result.
      if (session.submittedAt) return outcomeOf(session);
      const questions = readQuestions(session.questions);
      const saved = cleanAnswers(session.answers, questions);
      const onTime = acceptsAnswers(now, session.deadlineAt);
      // Late: the time is over, so only what was saved while it ran counts, and nothing is rejected.
      const answers = onTime ? { ...saved, ...cleanAnswers(input.answers, questions) } : saved;
      const { outcome } = await finalizeSession(db, session, {
        answers,
        auto: !onTime,
        submittedAt: onTime ? now : session.deadlineAt ?? now,
        localDate: input.localDate,
      });
      return outcome;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const now = new Date();
    return tolerateMissingSchema(
      FEATURE,
      async () => {
        const overdue = await db
          .select()
          .from(practiceSessions)
          .where(and(eq(practiceSessions.userId, ctx.user.id), isNull(practiceSessions.submittedAt), isNotNull(practiceSessions.deadlineAt), lt(practiceSessions.deadlineAt, new Date(now.getTime() - PRACTICE_GRACE_SECONDS * 1000))))
          .limit(10);
        for (const session of overdue) await finalizeIfExpired(db, session, now);
        const rows = await db
          .select({
            id: practiceSessions.id,
            title: practiceSessions.title,
            scope: practiceSessions.scope,
            mode: practiceSessions.mode,
            score: practiceSessions.score,
            submittedAt: practiceSessions.submittedAt,
            createdAt: practiceSessions.createdAt,
          })
          .from(practiceSessions)
          .where(eq(practiceSessions.userId, ctx.user.id))
          .orderBy(desc(practiceSessions.createdAt), desc(practiceSessions.id))
          .limit(30);
        return rows.map(row => ({ ...row, status: row.submittedAt ? ("submitted" as const) : ("open" as const) }));
      },
      [] as Array<{ id: number; title: string; scope: SessionRow["scope"]; mode: SessionRow["mode"]; score: number | null; submittedAt: Date | null; createdAt: Date; status: "open" | "submitted" }>,
    );
  }),

  discard: protectedProcedure.input(z.object({ sessionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const session = await loadOwned(db, ctx.user.id, input.sessionId);
    if (session.submittedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a practice that is still open can be discarded." });
    await db.delete(practiceSessions).where(and(eq(practiceSessions.id, session.id), eq(practiceSessions.userId, ctx.user.id), isNull(practiceSessions.submittedAt)));
    return { discarded: true as const };
  }),

  /** Copies the missed questions into a new run. `similar` is for the client's flow: it then calls `addSimilar`, which is the only step that uses AI. */
  missedFrom: protectedProcedure
    .input(z.object({ origin: originInput, similar: z.boolean().optional(), questionCount: z.number().int().min(3).max(15).optional() }))
    .mutation(({ ctx, input }) => missedFrom(ctx.user.id, input)),

  addSimilar: protectedProcedure.input(z.object({ sessionId: z.number().int().positive() })).mutation(({ ctx, input }) => addSimilarQuestions(ctx.user, input.sessionId)),
});

// ------------------------------------------------------------ pack attempts, deletion, export

/** Records an exam pack attempt as a submitted session, so its misses can be explained and practised. Never fails the attempt. */
export async function recordPackAttempt(input: { userId: number; packId: number; title: string; questions: SessionQuestion[]; answers: Record<string, string>; recordingIds: number[]; courseId: number | null; score: number }): Promise<number | null> {
  let db: Db;
  try {
    db = await requireDb();
  } catch {
    return null;
  }
  try {
    const now = nowSeconds();
    const [result] = await db.insert(practiceSessions).values({
      userId: input.userId,
      mode: "review",
      scope: "pack",
      packId: input.packId,
      courseId: input.courseId,
      title: input.title.slice(0, 255),
      questions: input.questions,
      recordingIds: input.recordingIds,
      startedAt: now,
      submittedAt: now,
      answers: cleanAnswers(input.answers, input.questions),
      score: input.score,
      results: scoreSession(input.questions, input.answers).results.map(({ id, correct }) => ({ id, correct })),
    });
    const newId = Number((result as { insertId?: number }).insertId);
    await prunePackAttempts(db, input.userId, input.packId, newId);
    return newId;
  } catch (error) {
    if (!isSchemaMissingError(error)) console.error("[practice] could not record the pack attempt:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Always scoped to the pack owners: a pack id alone must never reach another person's sessions. */
export const MAX_PACK_ATTEMPTS_KEPT = 20;

/** Keeps the newest attempts of a pack (never the one just recorded) and drops older ones with their explanations. */
async function prunePackAttempts(db: Db, userId: number, packId: number, keepId: number) {
  try {
    const rows = await db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(and(eq(practiceSessions.userId, userId), eq(practiceSessions.packId, packId), eq(practiceSessions.scope, "pack"), isNotNull(practiceSessions.submittedAt)))
      .orderBy(desc(practiceSessions.id));
    const keep = new Set([keepId, ...rows.slice(0, MAX_PACK_ATTEMPTS_KEPT).map(row => row.id)]);
    const doomed = rows.map(row => row.id).filter(id => !keep.has(id));
    if (doomed.length === 0) return;
    await db.delete(practiceSessions).where(and(eq(practiceSessions.userId, userId), inArray(practiceSessions.id, doomed)));
    await deleteExplanationsForAttempts(userId, doomed.map(id => `session:${id}`));
  } catch (error) {
    console.warn("[practice] could not prune old pack attempts:", error instanceof Error ? error.message : error);
  }
}

export async function deleteSessionsForPacks(userIds: number | number[], packIds: number[]) {
  const owners = Array.isArray(userIds) ? userIds : [userIds];
  if (packIds.length === 0 || owners.length === 0) return;
  const db = await requireDb();
  await tolerateMissingSchema(FEATURE, () => db.delete(practiceSessions).where(and(inArray(practiceSessions.userId, owners), inArray(practiceSessions.packId, packIds))), undefined);
}

/** A session holds copies of questions written from its recordings, so it goes when any of them is permanently deleted. */
export async function deleteSessionsForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingSchema(
    FEATURE,
    async () => {
      const owners = await db.selectDistinct({ userId: recordings.userId }).from(recordings).where(inArray(recordings.id, recordingIds));
      if (owners.length === 0) return;
      const purged = new Set(recordingIds);
      const rows = await db
        .select({ id: practiceSessions.id, recordingIds: practiceSessions.recordingIds, questions: practiceSessions.questions })
        .from(practiceSessions)
        .where(inArray(practiceSessions.userId, owners.map(owner => owner.userId)));
      const doomed = rows
        .filter(row => (Array.isArray(row.recordingIds) && row.recordingIds.some(id => purged.has(id))) || readQuestions(row.questions).some(question => question.recordingId && purged.has(question.recordingId)))
        .map(row => row.id);
      for (let i = 0; i < doomed.length; i += 500) await db.delete(practiceSessions).where(inArray(practiceSessions.id, doomed.slice(i, i + 500)));
    },
    undefined,
  );
}

export async function deleteSessionsForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema(FEATURE, () => db.delete(practiceSessions).where(eq(practiceSessions.userId, userId)), undefined);
}

export async function exportSessionsForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    FEATURE,
    async () => (await db.select().from(practiceSessions).where(eq(practiceSessions.userId, userId))).map(({ openKey, similarClaimedAt, similarAddedAt, userId: _owner, ...row }) => row),
    [] as Array<Omit<SessionRow, "openKey" | "similarClaimedAt" | "similarAddedAt" | "userId">>,
  );
}

