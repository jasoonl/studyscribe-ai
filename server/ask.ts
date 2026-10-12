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
  type AskHistoryMessage,
  type AskSource,
  type Citation,
} from "./askRetrieval";

/** Most recordings pulled into memory for one question. Newest first. */
const MAX_SOURCES = 40;

export type AskResult = { answer: string; citations: Citation[]; searched: number };

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
}): Promise<AskResult> {
  const history = input.history ?? [];
  let terms = extractSearchTerms(input.question);
  if (terms.length === 0) {
    // "Why?" or "and the second one?" -- lean on the previous question.
    const previous = [...history].reverse().find(message => message.role === "user");
    if (previous) terms = extractSearchTerms(previous.content);
  }

  if (terms.length === 0) {
    return { answer: "Ask about a topic, a term, or something a lecturer said, and I will look for it in your recordings.", citations: [], searched: 0 };
  }

  let restrictTo: number[] | null = null;
  if (input.courseId !== undefined) restrictTo = await recordingIdsInCourse(input.userId, input.courseId);

  const sources = await loadSources(input.userId, terms, restrictTo);
  const passages = rankPassages(sources.flatMap(source => buildPassages(source)), terms);

  if (passages.length === 0) {
    return { answer: NOTHING_FOUND_ANSWER, citations: [], searched: sources.length };
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
  return { answer, citations: parseCitations(answer, passages), searched: sources.length };
}
