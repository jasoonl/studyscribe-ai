import { createHash } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { recordings, transcriptChunks, transcripts } from "../drizzle/schema";
import { type AskSource, type Passage, buildPassages } from "./askRetrieval";
import { getDb } from "./db";
import { tolerateMissingSchema } from "./schemaTolerance";
import { TRPCError } from "@trpc/server";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Semantic search for Ask StudyScribe (C2). Transcripts are cut into the same
 * ~700-character passages Ask already cites, embedded through any
 * OpenAI-compatible /embeddings endpoint, and stored as float32 bytes in
 * `transcriptChunks`.
 *
 * Storage trade-off: TiDB has a VECTOR type with ANN indexes, but MySQL and
 * MariaDB (local development, other hosts) do not, so vectors are stored as
 * BLOBs and ranked in Node by cosine similarity over a candidate set: the
 * person's own chunks, newest recordings first, capped at MAX_CANDIDATE_CHUNKS.
 * That is exact (no approximate index) and cheap for a student's library
 * (thousands of chunks), but it reads every candidate per question; a very
 * large library would want TiDB's VECTOR column and VEC_COSINE_DISTANCE
 * instead, with the same table shape.
 *
 * Off cleanly unless OPENAI_EMBEDDING_MODEL is set. Embedding runs inside the
 * 60s budget: right after a transcript completes (with a short timeout, and
 * failures ignored), and otherwise lazily in small batches when Ask is used or
 * when the person presses "Index recordings".
 */

/** Same size as the passages Ask ranks by keyword, so both rankings talk about the same passages. */
export const CHUNK_TARGET_CHARS = 700;
export const MAX_CANDIDATE_CHUNKS = 6000;
const EMBED_BATCH = 64;

export type EmbeddingConfig = { baseUrl: string; apiKey: string; model: string; dimensions?: number };

export function getEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | null {
  const model = env.OPENAI_EMBEDDING_MODEL?.trim();
  const apiKey = (env.OPENAI_EMBEDDING_API_KEY || env.OPENAI_API_KEY)?.trim();
  if (!model || !apiKey) return null;
  const baseUrl = (env.OPENAI_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/$/, "");
  const dims = Number.parseInt(env.OPENAI_EMBEDDING_DIMENSIONS ?? "", 10);
  return { baseUrl, apiKey, model, dimensions: Number.isFinite(dims) && dims > 0 ? dims : undefined };
}

export function isEmbeddingConfigured() {
  return getEmbeddingConfig() !== null;
}

// ---------------------------------------------------------------- pure helpers

export function encodeVector(vector: number[]): Buffer {
  const array = new Float32Array(vector);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

export function decodeVector(buffer: Buffer): Float32Array {
  // Copy into an aligned buffer: a Buffer slice may start at an odd offset.
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return new Float32Array(copy);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Hash of what the chunks were built from; a change means re-embedding. */
export function transcriptContentHash(source: Pick<AskSource, "fullText" | "segments">): string {
  const segments = (source.segments ?? []).map(segment => `${segment.start}|${segment.text}`).join("\n");
  return createHash("sha256").update(source.fullText).update("\u0000").update(segments).digest("hex");
}

export type Chunk = { chunkIndex: number; start: number | null; text: string };

export function chunkTranscript(source: AskSource, maxChars = CHUNK_TARGET_CHARS): Chunk[] {
  return buildPassages(source, maxChars)
    .map((passage, index) => ({ chunkIndex: index, start: passage.start, text: passage.text.trim() }))
    .filter(chunk => chunk.text.length > 0);
}

export type ScoredChunk = { recordingId: number; title: string; start: number | null; text: string; score: number };

/** Top `limit` chunks by cosine similarity to the query vector. */
export function rankBySimilarity(
  query: ArrayLike<number>,
  candidates: Array<{ recordingId: number; title: string; start: number | null; text: string; vector: ArrayLike<number> }>,
  limit: number,
  minScore = 0.2,
): ScoredChunk[] {
  return candidates
    .map(candidate => ({ recordingId: candidate.recordingId, title: candidate.title, start: candidate.start, text: candidate.text, score: cosineSimilarity(query, candidate.vector) }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const passageKey = (passage: Pick<Passage, "recordingId" | "start" | "text">) =>
  `${passage.recordingId}:${passage.start === null ? "x" : Math.floor(passage.start)}:${passage.text.trim().slice(0, 80)}`;

/**
 * Reciprocal rank fusion of keyword-ranked and embedding-ranked passages.
 * Both lists are already in best-first order; a passage found by both rises.
 * RRF needs no score calibration between the two very different scales.
 */
export function fuseRankings(keyword: Passage[], semantic: Passage[], options: { limit: number; perRecording: number; k?: number }): Passage[] {
  const k = options.k ?? 60;
  const scores = new Map<string, { passage: Passage; score: number; firstSeen: number }>();
  let order = 0;
  const add = (list: Passage[], weight: number) =>
    list.forEach((passage, rank) => {
      const key = passageKey(passage);
      const existing = scores.get(key);
      const gain = weight / (k + rank + 1);
      if (existing) existing.score += gain;
      else scores.set(key, { passage, score: gain, firstSeen: order++ });
    });
  add(keyword, 1);
  add(semantic, 1);
  const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen);
  const taken = new Map<number, number>();
  const result: Passage[] = [];
  for (const item of sorted) {
    const used = taken.get(item.passage.recordingId) ?? 0;
    if (used >= options.perRecording) continue;
    taken.set(item.passage.recordingId, used + 1);
    result.push(item.passage);
    if (result.length >= options.limit) break;
  }
  return result;
}

// ---------------------------------------------------------------- provider

export async function embedTexts(texts: string[], options: { timeoutMs?: number; config?: EmbeddingConfig } = {}): Promise<number[][]> {
  const config = options.config ?? getEmbeddingConfig();
  if (!config) throw new Error("Embeddings are not configured (set OPENAI_EMBEDDING_MODEL).");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map(text => text.slice(0, 8000));
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: batch, ...(config.dimensions ? { dimensions: config.dimensions } : {}) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Embeddings request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const json = (await response.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
    const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== batch.length) throw new Error("Embeddings response had the wrong number of vectors.");
    for (const item of data) out.push(item.embedding);
  }
  return out;
}

// ---------------------------------------------------------------- indexing

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

type IndexableRecording = { recordingId: number; userId: number; title: string; fullText: string; segments: AskSource["segments"] };

/** (Re)embeds one recording's transcript unless its chunks are already current. Returns the number of chunks written. */
export async function indexRecording(recording: IndexableRecording, options: { timeoutMs?: number } = {}): Promise<number> {
  const config = getEmbeddingConfig();
  if (!config) return 0;
  const db = await requireDb();
  const hash = transcriptContentHash(recording);
  const existing = await db
    .select({ contentHash: transcriptChunks.contentHash, model: transcriptChunks.model })
    .from(transcriptChunks)
    .where(eq(transcriptChunks.recordingId, recording.recordingId))
    .limit(1);
  if (existing[0] && existing[0].contentHash === hash && existing[0].model === config.model) return 0;

  const chunks = chunkTranscript({ recordingId: recording.recordingId, title: recording.title, fullText: recording.fullText, segments: recording.segments });
  const vectors = chunks.length ? await embedTexts(chunks.map(chunk => chunk.text), { timeoutMs: options.timeoutMs, config }) : [];
  await db.delete(transcriptChunks).where(eq(transcriptChunks.recordingId, recording.recordingId));
  for (let i = 0; i < chunks.length; i += 100) {
    await db.insert(transcriptChunks).values(
      chunks.slice(i, i + 100).map((chunk, offset) => ({
        recordingId: recording.recordingId,
        userId: recording.userId,
        chunkIndex: chunk.chunkIndex,
        startSeconds: chunk.start === null ? null : Math.floor(chunk.start),
        text: chunk.text,
        embedding: encodeVector(vectors[i + offset]),
        model: config.model,
        contentHash: hash,
      })),
    );
  }
  return chunks.length;
}

/** Right after a transcript completes. Short timeout, never throws: the transcript matters more than the index. */
export async function indexRecordingQuietly(recordingId: number, timeoutMs = 15_000) {
  if (!isEmbeddingConfigured()) return;
  try {
    const db = await requireDb();
    const [row] = await db
      .select({ recordingId: recordings.id, userId: recordings.userId, title: recordings.title, fullText: transcripts.fullText, segments: transcripts.segments })
      .from(recordings)
      .innerJoin(transcripts, eq(transcripts.recordingId, recordings.id))
      .where(eq(recordings.id, recordingId))
      .limit(1);
    if (row) await tolerateMissingSchema("embeddings", () => indexRecording(row, { timeoutMs }), 0);
  } catch (error) {
    console.warn(`[embeddings] indexing recording ${recordingId} failed (it will be retried lazily):`, error instanceof Error ? error.message : error);
  }
}

async function completedTranscripts(userId: number) {
  const db = await requireDb();
  return db
    .select({ recordingId: recordings.id, userId: recordings.userId, title: recordings.title, fullText: transcripts.fullText, segments: transcripts.segments, createdAt: recordings.createdAt })
    .from(recordings)
    .innerJoin(transcripts, eq(transcripts.recordingId, recordings.id))
    .where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0), eq(transcripts.status, "completed")))
    .orderBy(desc(recordings.createdAt));
}

async function indexedState(userId: number) {
  const db = await requireDb();
  const rows = await db
    .selectDistinct({ recordingId: transcriptChunks.recordingId, contentHash: transcriptChunks.contentHash, model: transcriptChunks.model })
    .from(transcriptChunks)
    .where(eq(transcriptChunks.userId, userId));
  return new Map(rows.map(row => [row.recordingId, row]));
}

export type IndexStatus = { configured: boolean; available: boolean; total: number; indexed: number };

export async function getIndexStatus(userId: number): Promise<IndexStatus> {
  const config = getEmbeddingConfig();
  if (!config) return { configured: false, available: true, total: 0, indexed: 0 };
  const result = await tolerateMissingSchema(
    "embeddings",
    async () => {
      const [all, state] = await Promise.all([completedTranscripts(userId), indexedState(userId)]);
      const indexed = all.filter(row => {
        const current = state.get(row.recordingId);
        return current && current.model === config.model && current.contentHash === transcriptContentHash(row);
      }).length;
      return { configured: true, available: true, total: all.length, indexed };
    },
    null,
  );
  return result ?? { configured: true, available: false, total: 0, indexed: 0 };
}

/**
 * Embeds recordings that are missing or stale, newest first, until the
 * deadline. Each call does a bounded amount of work so it fits in one request;
 * the client calls again while `remaining` is above zero.
 */
export async function backfillEmbeddings(userId: number, options: { deadlineMs: number; maxRecordings?: number }): Promise<{ indexed: number; remaining: number; failed?: string }> {
  const config = getEmbeddingConfig();
  if (!config) return { indexed: 0, remaining: 0 };
  return (
    (await tolerateMissingSchema(
      "embeddings",
      async () => {
        const deadline = Date.now() + options.deadlineMs;
        const [all, state] = await Promise.all([completedTranscripts(userId), indexedState(userId)]);
        const stale = all.filter(row => {
          const current = state.get(row.recordingId);
          return !current || current.model !== config.model || current.contentHash !== transcriptContentHash(row);
        });
        let indexed = 0;
        let failed: string | undefined;
        for (const row of stale.slice(0, options.maxRecordings ?? 20)) {
          const left = deadline - Date.now();
          if (left < 4_000) break;
          try {
            await indexRecording(row, { timeoutMs: Math.min(20_000, left - 1_000) });
            indexed += 1;
          } catch (error) {
            failed = error instanceof Error ? error.message : "Embedding failed";
            break;
          }
        }
        return { indexed, remaining: stale.length - indexed, failed };
      },
      null,
    )) ?? { indexed: 0, remaining: 0 }
  );
}

/** Semantic candidates for a question across the person's recordings (optionally only some). */
export async function semanticPassages(userId: number, question: string, restrictTo: number[] | null, limit: number): Promise<Passage[]> {
  const config = getEmbeddingConfig();
  if (!config) return [];
  if (restrictTo && restrictTo.length === 0) return [];
  const db = await requireDb();
  const rows = await db
    .select({ recordingId: transcriptChunks.recordingId, title: recordings.title, start: transcriptChunks.startSeconds, text: transcriptChunks.text, embedding: transcriptChunks.embedding })
    .from(transcriptChunks)
    .innerJoin(recordings, eq(recordings.id, transcriptChunks.recordingId))
    .where(
      and(
        eq(transcriptChunks.userId, userId),
        eq(recordings.userId, userId),
        eq(recordings.isDeleted, 0),
        eq(transcriptChunks.model, config.model),
        restrictTo ? inArray(transcriptChunks.recordingId, restrictTo) : undefined,
      ),
    )
    .orderBy(desc(recordings.createdAt))
    .limit(MAX_CANDIDATE_CHUNKS);
  if (rows.length === 0) return [];
  const [queryVector] = await embedTexts([question], { timeoutMs: 10_000, config });
  return rankBySimilarity(
    queryVector,
    rows.map(row => ({ recordingId: row.recordingId, title: row.title, start: row.start, text: row.text, vector: decodeVector(row.embedding) })),
    limit,
  ).map(item => ({ recordingId: item.recordingId, title: item.title, start: item.start, text: item.text }));
}

export async function deleteChunksForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingSchema("embeddings", () => db.delete(transcriptChunks).where(inArray(transcriptChunks.recordingId, recordingIds)), undefined);
}

export async function deleteChunksForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema("embeddings", () => db.delete(transcriptChunks).where(eq(transcriptChunks.userId, userId)), undefined);
}

/** Account export lists which passages were embedded, not the vectors (derived data, not useful to a person). */
export async function exportChunksForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "embeddings",
    () =>
      db
        .select({ recordingId: transcriptChunks.recordingId, chunkIndex: transcriptChunks.chunkIndex, startSeconds: transcriptChunks.startSeconds, text: transcriptChunks.text, model: transcriptChunks.model, createdAt: transcriptChunks.createdAt })
        .from(transcriptChunks)
        .where(eq(transcriptChunks.userId, userId)),
    [],
  );
}

// ---------------------------------------------------------------- router

export const smartSearchRouter = router({
  /** Whether semantic search is on, and how much of the library is indexed. */
  status: protectedProcedure.query(({ ctx }) => getIndexStatus(ctx.user.id)),

  /** Embeds the next few missing recordings; the Ask page calls it until `remaining` is 0. */
  indexNext: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isEmbeddingConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Smart search is not set up on this server." });
    if (!checkTrpcRateLimit(`embed-backfill:${ctx.user.id}`, 60_000, 30)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Indexing is busy. Try again in a minute." });
    return backfillEmbeddings(ctx.user.id, { deadlineMs: 40_000, maxRecordings: 10 });
  }),
});
