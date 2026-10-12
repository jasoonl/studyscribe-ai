import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { chatHistory, recordings, transcripts } from "../drizzle/schema";
import { recordingIdsInCourse } from "./courses";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import {
  NOTHING_FOUND_ANSWER,
  buildAskMessages,
  buildPassages,
  escapeLike,
  extractSearchTerms,
  parseCitations,
  rankPassages,
  MAX_PASSAGES,
  MAX_PASSAGES_PER_RECORDING,
  type AskHistoryMessage,
  type AskSource,
  type Citation,
  type Passage,
} from "./askRetrieval";
import { backfillEmbeddings, fuseRankings, isEmbeddingConfigured, semanticPassages } from "./embeddings";

/** Most recordings pulled into memory for one question. Newest first. */
const MAX_SOURCES = 40;

/** Candidates each retriever contributes before fusion. */
const CANDIDATES_PER_RETRIEVER = 24;

export type AskResult = { answer: string; citations: Citation[]; searched: number; retrieval: "keyword" | "hybrid" };

/**
 * Embedding candidates for the question, or none. Before searching it embeds
 * a few recordings that are missing from the index (a few seconds at most),
 * so a library fills in as Ask is used. Any failure falls back to keyword-only.
 */
async function loadSemantic(userId: number, query: string, restrictTo: number[] | null): Promise<Passage[]> {
  if (!isEmbeddingConfigured()) return [];
  try {
    await backfillEmbeddings(userId, { deadlineMs: 8_000, maxRecordings: 5 });
    return await semanticPassages(userId, query, restrictTo, CANDIDATES_PER_RETRIEVER);
  } catch (error) {
    console.warn("[ask] semantic search unavailable, using keywords only:", error instanceof Error ? error.message : error);
    return [];
  }
}

async function loadSources(userId: number, terms: string[], restrictTo: number[] | null): Promise<AskSource[]> {
  if (restrictTo && restrictTo.length === 0) return [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const termMatches = terms.map(term => like(transcripts.fullText, `%${escapeLike(term)}%`));
  const rows = await db
    .select({
      recordingId: recordings.id,
      title: recordings.title,
      fullText: transcripts.fullText,
      segments: transcripts.segments,
    })
    .from(recordings)
    .innerJoin(transcripts, eq(transcripts.recordingId, recordings.id))
    .where(
      and(
        eq(recordings.userId, userId),
        eq(recordings.isDeleted, 0),
        eq(transcripts.status, "completed"),
        restrictTo ? inArray(recordings.id, restrictTo) : undefined,
        or(...termMatches),
      ),
    )
    .orderBy(desc(recordings.createdAt))
    .limit(MAX_SOURCES);
  return rows;
}

/**
 * Chat rows for Ask have no recording. Before migration 0019 the column is
 * still NOT NULL, so the insert fails; losing the history row must never lose
 * the answer.
 */
async function rememberExchange(userId: number, question: string, answer: string) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(chatHistory).values([
      { recordingId: null, userId, role: "user" as const, content: question },
      { recordingId: null, userId, role: "assistant" as const, content: answer },
    ]);
  } catch (error) {
    console.warn("[ask] could not store the exchange (has migration 0019 been applied?)", error instanceof Error ? error.message : error);
  }
}

export async function askAcrossRecordings(input: {
  userId: number;
  question: string;
  courseId?: number;
  history?: AskHistoryMessage[];
  /** Overridable so tests can run without a model. */
  complete?: (messages: ReturnType<typeof buildAskMessages>) => Promise<string>;
  /** Overridable so tests can run without an embeddings provider. */
  semantic?: (query: string) => Promise<Passage[]>;
}): Promise<AskResult> {
  const history = input.history ?? [];
  let terms = extractSearchTerms(input.question);
  if (terms.length === 0) {
    // "Why?" or "and the second one?" -- lean on the previous question.
    const previous = [...history].reverse().find(message => message.role === "user");
    if (previous) terms = extractSearchTerms(previous.content);
  }

  let restrictTo: number[] | null = null;
  if (input.courseId !== undefined) restrictTo = await recordingIdsInCourse(input.userId, input.courseId);

  // A follow-up like "and the second one?" carries little meaning alone; give
  // the embedding search the previous question too.
  const previousQuestion = [...history].reverse().find(message => message.role === "user")?.content;
  const semanticQuery = input.question.trim().split(/\s+/).length < 4 && previousQuestion ? `${previousQuestion}\n${input.question}` : input.question;
  const semantic = await (input.semantic ?? (query => loadSemantic(input.userId, query, restrictTo)))(semanticQuery);

  if (terms.length === 0 && semantic.length === 0) {
    return { answer: "Ask about a topic, a term, or something a lecturer said, and I will look for it in your recordings.", citations: [], searched: 0, retrieval: "keyword" };
  }

  const sources = terms.length ? await loadSources(input.userId, terms, restrictTo) : [];
  const retrieval: AskResult["retrieval"] = semantic.length ? "hybrid" : "keyword";
  const passages =
    retrieval === "hybrid"
      ? fuseRankings(rankPassages(sources.flatMap(source => buildPassages(source)), terms, { limit: CANDIDATES_PER_RETRIEVER, perRecording: CANDIDATES_PER_RETRIEVER }), semantic, {
          limit: MAX_PASSAGES,
          perRecording: MAX_PASSAGES_PER_RECORDING,
        })
      : rankPassages(sources.flatMap(source => buildPassages(source)), terms);
  const searched = new Set([...sources.map(source => source.recordingId), ...semantic.map(passage => passage.recordingId)]).size;

  if (passages.length === 0) {
    return { answer: NOTHING_FOUND_ANSWER, citations: [], searched, retrieval };
  }

  const messages = buildAskMessages(input.question, passages, history);
  const complete =
    input.complete ??
    (async (prompt: ReturnType<typeof buildAskMessages>) => {
      const response = await invokeLLM({ messages: prompt });
      const content = response.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    });

  let answer: string;
  try {
    answer = (await complete(messages)).trim();
  } catch (error) {
    console.error("[ask] model call failed:", error instanceof Error ? error.message : error);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The assistant could not answer right now. Try again in a moment." });
  }
  if (!answer) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The assistant returned an empty answer. Try rephrasing the question." });
  }

  await rememberExchange(input.userId, input.question, answer);
  return { answer, citations: parseCitations(answer, passages), searched, retrieval };
}
