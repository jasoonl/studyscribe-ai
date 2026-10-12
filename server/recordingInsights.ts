import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { studyNotes } from "../drizzle/schema";
import { formatTimestamp } from "@shared/timestamp";
import { getDb, getRecordingById, getTranscriptByRecordingId } from "./db";
import { completeJson } from "./llmJson";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";
import {
  CHAPTERS_RESPONSE_FORMAT,
  KEY_TERMS_RESPONSE_FORMAT,
  buildChaptersMessages,
  buildKeyTermsMessages,
  chaptersToMarkdown,
  countOccurrences,
  insightKindOf,
  normalizeChapters,
  normalizeKeyTerms,
  type Chapter,
  type InsightKind,
} from "./studyExtraction";
import { SINGLE_RECORDING_BUDGET, condenseTranscript } from "./transcriptBudget";

/**
 * Key terms (B6) and chapters (B8). Both are generated on request from a
 * bounded transcript and stored as studyNotes rows tagged with
 * `metadata.insight`, so they need no table of their own.
 */

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function ownTranscript(recordingId: number, userId: number) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
  const transcript = await getTranscriptByRecordingId(recordingId);
  if (!transcript?.fullText?.trim()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The transcript is not ready yet." });
  }
  return { recording, transcript };
}

async function insightRows(recordingIds: number[]) {
  if (recordingIds.length === 0) return [];
  const db = await requireDb();
  const rows = await db.select().from(studyNotes).where(inArray(studyNotes.recordingId, recordingIds));
  return rows.filter(row => insightKindOf(row.metadata) !== null);
}

async function replaceInsight(recordingId: number, userId: number, kind: InsightKind, content: string, metadata: Record<string, unknown>) {
  const db = await requireDb();
  const existing = (await insightRows([recordingId])).filter(row => insightKindOf(row.metadata) === kind);
  if (existing.length) await db.delete(studyNotes).where(and(eq(studyNotes.userId, userId), inArray(studyNotes.id, existing.map(row => row.id))));
  await db.insert(studyNotes).values({
    recordingId,
    userId,
    type: kind === "key_terms" ? "key_concepts" : "summary",
    content,
    metadata: { ...metadata, insight: kind },
  });
}

function readInsights(rows: Array<{ metadata: unknown; createdAt: Date }>, fullText: string) {
  let keyTerms: { terms: string[]; counts: Record<string, number> } | null = null;
  let chapters: Chapter[] | null = null;
  for (const row of rows) {
    const metadata = row.metadata as Record<string, unknown>;
    const kind = insightKindOf(metadata);
    if (kind === "key_terms" && Array.isArray(metadata.terms)) {
      const terms = (metadata.terms as unknown[]).filter((term): term is string => typeof term === "string");
      // Counts come from the current text, so they stay right after a transcript edit.
      keyTerms = { terms, counts: countOccurrences(terms, fullText) };
    }
    if (kind === "chapters" && Array.isArray(metadata.chapters)) chapters = metadata.chapters as Chapter[];
  }
  return { keyTerms, chapters };
}

function limit(userId: number) {
  if (!checkTrpcRateLimit(`insights:${userId}`, 10 * 60 * 1000, 30)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of requests in a short time. Give it a few minutes." });
  }
}

export const insightsRouter = router({
  get: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const recording = await getRecordingById(input.recordingId);
    if (!recording || recording.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
    const transcript = await getTranscriptByRecordingId(input.recordingId);
    return readInsights(await insightRows([input.recordingId]), transcript?.fullText ?? "");
  }),

  generateKeyTerms: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    limit(ctx.user.id);
    const { recording, transcript } = await ownTranscript(input.recordingId, ctx.user.id);
    const condensed = condenseTranscript({ segments: transcript.segments, fullText: transcript.fullText }, SINGLE_RECORDING_BUDGET);
    const raw = await completeJson({
      messages: buildKeyTermsMessages({ title: recording.title, transcript: condensed.text }),
      responseFormat: KEY_TERMS_RESPONSE_FORMAT,
      maxTokens: 600,
      what: "key terms",
    });
    const terms = normalizeKeyTerms(raw, transcript.fullText);
    if (terms.length === 0) {
      throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "No key terms stood out in this transcript." });
    }
    await replaceInsight(recording.id, ctx.user.id, "key_terms", terms.join(", "), { terms });
    return { terms, counts: countOccurrences(terms, transcript.fullText) };
  }),

  generateChapters: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    limit(ctx.user.id);
    const { recording, transcript } = await ownTranscript(input.recordingId, ctx.user.id);
    const condensed = condenseTranscript({ segments: transcript.segments, fullText: transcript.fullText }, SINGLE_RECORDING_BUDGET);
    if (!condensed.timestamped) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This transcript has no timestamps, so it cannot be split into chapters." });
    }
    const lastSegment = Array.isArray(transcript.segments) ? transcript.segments[transcript.segments.length - 1] : undefined;
    const duration = recording.duration && recording.duration > 0 ? recording.duration : lastSegment ? Math.ceil(lastSegment.end ?? lastSegment.start) : null;
    const raw = await completeJson({
      messages: buildChaptersMessages({ title: recording.title, transcript: condensed.text, durationSeconds: duration }),
      responseFormat: CHAPTERS_RESPONSE_FORMAT,
      maxTokens: 1800,
      what: "chapters",
    });
    const chapters = normalizeChapters(raw, duration);
    if (chapters.length === 0) {
      throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "The chapters came back empty. Try again." });
    }
    await replaceInsight(recording.id, ctx.user.id, "chapters", chaptersToMarkdown(chapters, formatTimestamp), { chapters });
    return { chapters };
  }),
});
