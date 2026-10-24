import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { chatHistory, recordings, studySourceUnits, studySources, transcripts } from "../drizzle/schema";
import { recordingIdsInCourse } from "./courses";
import { getDb } from "./db";
import { tolerateMissingSchema } from "./schemaTolerance";
import { invokeLLM } from "./_core/llm";
import {
  NOTHING_FOUND_ANSWER,
  NOTHING_FOUND_WITH_SOURCES_ANSWER,
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

/** Study source units pulled into memory for one question. Newest sources first. */
const MAX_SOURCE_UNITS = 200;

export type AskResult = {
  answer: string;
  citations: Citation[];
  /** Recordings that had a match. */
  searched: number;
  /** Study sources that had a match. */
  searchedSources: number;
  retrieval: "keyword" | "hybrid";
};

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

/** "Slide 7: Cell cycle" -> "Slide 7"; the part of a unit label before its title. */
export function shortLocation(label: string) {
  return label.split(":")[0].replace(/\s*\(cont\.\)\s*$/, "").trim() || label;
}

/**
 * Keyword matches inside the person's study sources, as passages tagged with
 * the source and where in it they came from. Before migration 0034 there are
 * none. Only sources whose text has been read are searched.
 */
export async function loadSourcePassages(userId: number, terms: string[], courseId?: number, sourceIds?: number[]): Promise<Passage[]> {
  if (terms.length === 0 || (sourceIds && sourceIds.length === 0)) return [];
  const db = await getDb();
  if (!db) return [];
  const termMatches = terms.map(term => like(studySourceUnits.text, `%${escapeLike(term)}%`));
  const rows = await tolerateMissingSchema(
    "study sources",
    () =>
      db
        .select({
          sourceId: studySources.id,
          title: studySources.title,
          unitIndex: studySourceUnits.unitIndex,
          label: studySourceUnits.label,
          text: studySourceUnits.text,
        })
        .from(studySourceUnits)
        .innerJoin(studySources, eq(studySources.id, studySourceUnits.sourceId))
        .where(
          and(
            eq(studySources.userId, userId),
            eq(studySourceUnits.userId, userId),
            inArray(studySources.status, ["extracted", "analyzing", "ready"]),
            courseId !== undefined ? eq(studySources.courseId, courseId) : undefined,
            sourceIds ? inArray(studySources.id, sourceIds) : undefined,
            or(...termMatches),
          ),
        )
        .orderBy(desc(studySources.createdAt), desc(studySources.id), studySourceUnits.unitIndex)
        .limit(MAX_SOURCE_UNITS),
    [] as Array<{ sourceId: number; title: string; unitIndex: number; label: string; text: string }>,
  );
  const passages: Passage[] = [];
  for (const row of rows) {
    if (typeof row.text !== "string" || typeof row.sourceId !== "number") continue;
    const location = shortLocation(row.label);
    for (const passage of buildPassages({ recordingId: 0, title: row.title, fullText: row.text, segments: null })) {
      passages.push({ ...passage, sourceId: row.sourceId, location, unitIndex: row.unitIndex });
    }
  }
  return passages;
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
  /** Search the person's uploaded study sources too (default true). */
  includeSources?: boolean;
  /** Search recordings (default true). */
  includeRecordings?: boolean;
  /** Limit the source search to these sources. */
  sourceIds?: number[];
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

  const includeRecordings = input.includeRecordings ?? true;
  const includeSources = input.includeSources ?? true;
  if (!includeRecordings && !includeSources) {
    return { answer: "Pick recordings, study sources or both to search.", citations: [], searched: 0, searchedSources: 0, retrieval: "keyword" };
  }

  let restrictTo: number[] | null = null;
  if (includeRecordings && input.courseId !== undefined) restrictTo = await recordingIdsInCourse(input.userId, input.courseId);

  // A follow-up like "and the second one?" carries little meaning alone; give
  // the embedding search the previous question too.
  const previousQuestion = [...history].reverse().find(message => message.role === "user")?.content;
  const semanticQuery = input.question.trim().split(/\s+/).length < 4 && previousQuestion ? `${previousQuestion}\n${input.question}` : input.question;
  const semantic = includeRecordings ? await (input.semantic ?? (query => loadSemantic(input.userId, query, restrictTo)))(semanticQuery) : [];

  if (terms.length === 0 && semantic.length === 0) {
    return { answer: "Ask about a topic, a term, or something a lecturer said, and I will look for it in your recordings.", citations: [], searched: 0, searchedSources: 0, retrieval: "keyword" };
  }

  const recordingRows = includeRecordings && terms.length ? await loadSources(input.userId, terms, restrictTo) : [];
  // Study sources join only the keyword ranking; they have no embeddings yet.
  const sourcePassages = includeSources ? await loadSourcePassages(input.userId, terms, input.courseId, input.sourceIds) : [];
  const keywordPassages = [...recordingRows.flatMap(source => buildPassages(source)), ...sourcePassages];
  const retrieval: AskResult["retrieval"] = semantic.length ? "hybrid" : "keyword";
  const passages =
    retrieval === "hybrid"
      ? fuseRankings(rankPassages(keywordPassages, terms, { limit: CANDIDATES_PER_RETRIEVER, perRecording: CANDIDATES_PER_RETRIEVER }), semantic, {
          limit: MAX_PASSAGES,
          perRecording: MAX_PASSAGES_PER_RECORDING,
        })
      : rankPassages(keywordPassages, terms);
  const searched = new Set([...recordingRows.map(source => source.recordingId), ...semantic.map(passage => passage.recordingId)]).size;
  const searchedSources = new Set(sourcePassages.map(passage => passage.sourceId)).size;

  if (passages.length === 0) {
    return { answer: searchedSources > 0 || (includeSources && !includeRecordings) ? NOTHING_FOUND_WITH_SOURCES_ANSWER : NOTHING_FOUND_ANSWER, citations: [], searched, searchedSources, retrieval };
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
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The assistant could not answer right now. Try again in a moment.", cause: error });
  }
  if (!answer) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The assistant returned an empty answer. Try rephrasing the question." });
  }

  // An answer that quotes a study source is not kept in the chat history, so deleting the source
  // cannot leave its text behind there.
  if (!passages.some(passage => passage.sourceId)) await rememberExchange(input.userId, input.question, answer);
  return { answer, citations: parseCitations(answer, passages), searched, searchedSources, retrieval };
}
