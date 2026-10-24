import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_EXPLANATIONS_PER_ATTEMPT } from "@shared/const";
import { questionExplanations, recordings, studySources, transcripts } from "../drizzle/schema";
import { describeAiFailure } from "./aiErrors";
import { buildPassages, extractSearchTerms, type Citation, type Passage } from "./askRetrieval";
import { loadSourcePassages } from "./ask";
import { getDb } from "./db";
import { buildExplanationMessages, EXPLANATION_RESPONSE_FORMAT, explanationInputHash, selectExplanationPassages, validateExplanation } from "./explanationPrompt";
import { isAnswerCorrect } from "./examPackBuilder";
import { completeJson } from "./llmJson";
import { isDuplicateKey, originInput, requireDb, resolveOrigin, type Db, type ResolvedOrigin } from "./practiceOrigin";
import type { SessionQuestion } from "./practiceBuilder";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { AI_BURST_LIMIT, assertCanGenerate, hasUsage, recordAiGeneration } from "./usage";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Explaining missed questions (Phase 8). Each explanation is written from the
 * person's own recordings and uploaded files only, cites them, is cached by a
 * hash of everything it was written from, and costs nothing when cached or
 * when nothing in their material covers the question. The questionExplanations
 * table arrives with migration 0035; before it the feature reads as off.
 */
const FEATURE = "Mistake explanations";
export const EXPLAIN_LIMIT = { windowMs: 10 * 60 * 1000, max: 40 };
/** The whole request, retrieval included, stays well inside the 60s function limit. */
export const EXPLAIN_BUDGET_MS = 52_000;
const MODEL_TIMEOUT_MS = 25_000;
const MIN_CALL_MS = 8_000;
/** Stable text for the per-attempt cap; the client tells it apart by the CONFLICT code. */
export const EXPLANATION_CAP_MESSAGE = `This attempt already has ${MAX_EXPLANATIONS_PER_ATTEMPT} explanations, the most one attempt can have. Practice what you missed, then explain the new misses.`;
const FAILED_MESSAGE = "Couldn't explain this one, try again.";

type StoredCitations = Citation[];

export type ExplainOutput = { status: "ready" | "not_covered"; text: string | null; citations: StoredCitations; cached: boolean };

const modelName = () => (process.env.OPENAI_MODEL || "gpt-4.1-mini").slice(0, 80);

/** Transcript passages of the given recordings (the person's own, finished, not in the Trash). */
async function loadRecordingPassages(db: Db, userId: number, recordingIds: number[]): Promise<Passage[]> {
  if (recordingIds.length === 0) return [];
  const rows = await db
    .select({ recordingId: recordings.id, title: recordings.title, fullText: transcripts.fullText, segments: transcripts.segments })
    .from(recordings)
    .innerJoin(transcripts, eq(transcripts.recordingId, recordings.id))
    .where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0), inArray(recordings.id, recordingIds.slice(0, 30)), eq(transcripts.status, "completed")));
  return rows.flatMap(row => buildPassages({ recordingId: row.recordingId, title: row.title, fullText: row.fullText ?? "", segments: row.segments as any }));
}

async function sourceContentHashes(db: Db, userId: number, passages: Passage[]): Promise<string[]> {
  const ids = Array.from(new Set(passages.map(passage => passage.sourceId).filter((id): id is number => !!id)));
  if (ids.length === 0) return [];
  const rows = await tolerateMissingSchema(
    "study sources",
    () => db.select({ hash: studySources.contentHash }).from(studySources).where(and(eq(studySources.userId, userId), inArray(studySources.id, ids))),
    [] as Array<{ hash: string | null }>,
  );
  return rows.map(row => row.hash ?? "");
}

function toOutput(row: { status: "ready" | "not_covered"; text: string | null; citations: unknown }, cached: boolean): ExplainOutput {
  return { status: row.status, text: row.status === "ready" ? row.text : null, citations: Array.isArray(row.citations) ? (row.citations as StoredCitations) : [], cached };
}

async function findByHash(db: Db, userId: number, inputHash: string) {
  const [row] = await db.select().from(questionExplanations).where(and(eq(questionExplanations.userId, userId), eq(questionExplanations.inputHash, inputHash))).limit(1);
  return row ?? null;
}

/** The excerpts a question would be explained from and the cache key for them. */
async function prepareQuestion(db: Db, userId: number, origin: ResolvedOrigin, question: SessionQuestion, userAnswer: string, preloaded?: Passage[]) {
  const terms = extractSearchTerms(`${question.question} ${question.correctAnswer}`);
  const preferred = question.recordingId ? [question.recordingId, ...origin.recordingIds.filter(id => id !== question.recordingId)] : origin.recordingIds;
  const [recordingPassages, sourcePassages] = await Promise.all([
    preloaded ? Promise.resolve(preloaded) : loadRecordingPassages(db, userId, preferred),
    origin.courseId !== null ? loadSourcePassages(userId, terms, origin.courseId) : Promise.resolve([] as Passage[]),
  ]);
  const passages = selectExplanationPassages([...recordingPassages, ...sourcePassages], terms, question.recordingId);
  const inputHash = explanationInputHash({
    question: question.question,
    correctAnswer: question.correctAnswer,
    userAnswer,
    passages,
    sourceContentHashes: await sourceContentHashes(db, userId, passages),
  });
  return { passages, inputHash };
}

type Person = { id: number; role?: string | null; loginMethod?: string | null; emailVerified?: number | null };

export async function explainMistake(user: Person, input: { origin: z.infer<typeof originInput>; questionId: string; userAnswer: string }, startedAt = Date.now()): Promise<ExplainOutput> {
  const db = await requireDb();
  const userId = user.id;
  const origin = await resolveOrigin(userId, input.origin);
  const question = origin.questions.find(candidate => candidate.id === input.questionId);
  if (!question) throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });

  // What was answered comes from the stored attempt, never from the request: the
  // answer is part of the cache key and of what the model is shown.
  const userAnswer = origin.answers[question.id] ?? "";
  if (isAnswerCorrect(question, userAnswer)) throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to explain: that answer was right." });

  const { passages, inputHash } = await prepareQuestion(db, userId, origin, question, userAnswer);

  const cached = await findByHash(db, userId, inputHash);
  if (cached) return toOutput(cached, true);

  const [{ used }] = await db
    .select({ used: sql<string>`COUNT(*)` })
    .from(questionExplanations)
    .where(and(eq(questionExplanations.userId, userId), eq(questionExplanations.attemptKey, origin.attemptKey)));
  if (Number(used) >= MAX_EXPLANATIONS_PER_ATTEMPT) {
    throw new TRPCError({ code: "CONFLICT", message: EXPLANATION_CAP_MESSAGE });
  }

  const base = { userId, inputHash, attemptKey: origin.attemptKey, questionId: question.id, recordingId: question.recordingId ?? null, model: modelName() };
  async function store(values: { status: "ready" | "not_covered"; text: string | null; citations: StoredCitations }): Promise<ExplainOutput | null> {
    try {
      await db.insert(questionExplanations).values({ ...base, ...values });
      return toOutput(values, false);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // A parallel request wrote the same explanation first: use it.
      const existing = await findByHash(db, userId, inputHash);
      return existing ? toOutput(existing, true) : null;
    }
  }

  // Nothing in their material covers it: no model call, no charge, and no made-up answer.
  if (passages.length === 0) {
    return (await store({ status: "not_covered", text: null, citations: [] })) ?? { status: "not_covered", text: null, citations: [], cached: true };
  }

  if (user.role !== "admin" && !checkTrpcRateLimit(`ai-burst:${userId}`, AI_BURST_LIMIT.windowMs, AI_BURST_LIMIT.max)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of AI requests in a few minutes. Wait a little and try again." });
  }
  if (user.role !== "admin" && !checkTrpcRateLimit(`explain:${userId}`, EXPLAIN_LIMIT.windowMs, EXPLAIN_LIMIT.max)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of explanations in a few minutes. Give it a little while." });
  }
  // The whole attempt is one AI generation, charged by its first explanation.
  const usageKey = `explain:${origin.attemptKey}`;
  if (!(await hasUsage(usageKey))) await assertCanGenerate(user);

  const messages = buildExplanationMessages({ question: question.question, correctAnswer: question.correctAnswer, userAnswer, passages });
  for (let attempt = 0; attempt < 2; attempt++) {
    // A retry only runs when enough of the request's time is left.
    const timeoutMs = Math.min(MODEL_TIMEOUT_MS, startedAt + EXPLAIN_BUDGET_MS - Date.now());
    if (timeoutMs < MIN_CALL_MS) break;
    let raw: unknown;
    try {
      raw = await completeJson({ messages, responseFormat: EXPLANATION_RESPONSE_FORMAT, maxTokens: 350, what: "the explanation", timeoutMs });
    } catch (error) {
      const failure = describeAiFailure(error);
      if (failure) {
        console.error("[mistakes] provider failure:", (error as { cause?: unknown })?.cause ?? (error as Error)?.message);
        throw new TRPCError({ code: failure.code, message: failure.message, cause: error });
      }
      // Unreadable output (no provider error behind it): try once more.
      continue;
    }
    const checked = validateExplanation(raw, passages);
    if (checked.kind === "invalid") {
      console.warn(`[mistakes] explanation rejected (${checked.reason}) for user ${userId}`);
      continue;
    }
    if (checked.kind === "not_covered") {
      return (await store({ status: "not_covered", text: null, citations: [] })) ?? { status: "not_covered", text: null, citations: [], cached: true };
    }
    const stored = await store({ status: "ready", text: checked.text, citations: checked.citations });
    // Charged once per attempt: a repeat key is a no-op.
    await recordAiGeneration(userId, usageKey);
    if (stored) return stored;
    break;
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: FAILED_MESSAGE });
}

export const mistakesRouter = router({
  explain: protectedProcedure
    .input(z.object({ origin: originInput, questionId: z.string().min(1).max(20), userAnswer: z.string().max(2000) }))
    .mutation(({ ctx, input }) => explainMissingSchema(FEATURE, () => explainMistake(ctx.user, input))),

  /**
   * Explanations for the attempt's missed questions, found by the same cache key
   * `explain` uses, so one written for an earlier attempt of the same question
   * and material shows here too. The 25-explanation cap counts the explanations
   * an attempt wrote itself (rows under its own key), not ones it reused.
   */
  list: protectedProcedure.input(z.object({ origin: originInput })).query(async ({ ctx, input }) => {
    let origin: ResolvedOrigin;
    try {
      origin = await resolveOrigin(ctx.user.id, input.origin);
    } catch (error) {
      if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED") return [];
      throw error;
    }
    const db = await requireDb();
    return tolerateMissingSchema(
      FEATURE,
      async () => {
        const missed = origin.questions.filter(question => !isAnswerCorrect(question, origin.answers[question.id]));
        if (missed.length === 0) return [];
        const shared = await loadRecordingPassages(db, ctx.user.id, origin.recordingIds);
        const hashes = new Map<string, string>();
        for (const question of missed) {
          const { inputHash } = await prepareQuestion(db, ctx.user.id, origin, question, origin.answers[question.id] ?? "", shared);
          hashes.set(inputHash, question.id);
        }
        const rows = await db
          .select()
          .from(questionExplanations)
          .where(and(eq(questionExplanations.userId, ctx.user.id), inArray(questionExplanations.inputHash, Array.from(hashes.keys()))));
        const out: Array<{ questionId: string; status: "ready" | "not_covered"; text: string | null; citations: StoredCitations }> = [];
        const seen = new Set<string>();
        for (const row of rows) {
          const questionId = hashes.get(row.inputHash);
          if (!questionId || seen.has(questionId)) continue;
          seen.add(questionId);
          out.push({ questionId, status: row.status, text: row.status === "ready" ? row.text : null, citations: Array.isArray(row.citations) ? (row.citations as StoredCitations) : [] });
        }
        return out;
      },
      [],
    );
  }),
});

// ------------------------------------------------------------ deletion and export

function mentions(citations: unknown, test: (citation: { recordingId?: number; sourceId?: number }) => boolean) {
  return Array.isArray(citations) && citations.some(citation => citation && typeof citation === "object" && test(citation as { recordingId?: number; sourceId?: number }));
}

/** An explanation quotes the material it cites, so it goes with any recording it was written for or quotes. */
export async function deleteExplanationsForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema(
    FEATURE,
    async () => {
      const owners = await db.selectDistinct({ userId: recordings.userId }).from(recordings).where(inArray(recordings.id, recordingIds));
      if (owners.length === 0) return;
      const purged = new Set(recordingIds);
      const rows = await db
        .select({ id: questionExplanations.id, recordingId: questionExplanations.recordingId, citations: questionExplanations.citations })
        .from(questionExplanations)
        .where(inArray(questionExplanations.userId, owners.map(owner => owner.userId)));
      const doomed = rows.filter(row => (row.recordingId !== null && purged.has(row.recordingId)) || mentions(row.citations, citation => !citation.sourceId && purged.has(Number(citation.recordingId)))).map(row => row.id);
      for (let i = 0; i < doomed.length; i += 500) await db.delete(questionExplanations).where(inArray(questionExplanations.id, doomed.slice(i, i + 500)));
    },
    undefined,
  );
}

/** A deleted or moved study source can never be quoted again. */
export async function deleteExplanationsForSources(userId: number, sourceIds: number[]) {
  if (sourceIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const gone = new Set(sourceIds);
  await tolerateMissingSchema(
    FEATURE,
    async () => {
      const rows = await db.select({ id: questionExplanations.id, citations: questionExplanations.citations }).from(questionExplanations).where(eq(questionExplanations.userId, userId));
      const doomed = rows.filter(row => mentions(row.citations, citation => !!citation.sourceId && gone.has(Number(citation.sourceId)))).map(row => row.id);
      for (let i = 0; i < doomed.length; i += 500) await db.delete(questionExplanations).where(inArray(questionExplanations.id, doomed.slice(i, i + 500)));
    },
    undefined,
  );
}

export async function deleteExplanationsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema(FEATURE, () => db.delete(questionExplanations).where(eq(questionExplanations.userId, userId)), undefined);
}

/** Account export: the text and citations, without cache hashes. */
export async function exportExplanationsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return tolerateMissingSchema(
    FEATURE,
    async () => (await db.select().from(questionExplanations).where(eq(questionExplanations.userId, userId))).map(({ inputHash, userId: _owner, ...row }) => row),
    [] as Array<Omit<typeof questionExplanations.$inferSelect, "inputHash" | "userId">>,
  );
}

/** Explanations written under the given attempt keys (for attempts that were pruned). */
export async function deleteExplanationsForAttempts(userId: number, attemptKeys: string[]) {
  if (attemptKeys.length === 0) return;
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema(
    FEATURE,
    () => db.delete(questionExplanations).where(and(eq(questionExplanations.userId, userId), inArray(questionExplanations.attemptKey, attemptKeys))),
    undefined,
  );
}
