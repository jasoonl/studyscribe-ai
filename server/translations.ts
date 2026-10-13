import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { translations, usageEvents } from "../drizzle/schema";
import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import { getDb, getRecordingById, getStudyGuideById, getStudyNoteById, getTranscriptByRecordingId } from "./db";
import { completeJson, completeText } from "./llmJson";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { chunkMarkdown, chunkTranscript, parseTranslatedLines, type TranslationChunk } from "./translationChunks";
import { assertCanGenerate, recordUsage } from "./usage";
import { usagePeriod } from "./usageRules";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * "Translate to..." for transcripts, study guides and notes (F7). The client
 * asks for the chunk list, then translates one chunk per request (each well
 * inside the 60s function limit) and shows each part as it arrives. Finished
 * chunks are stored, so reopening a translation is instant; a chunk whose
 * source changed (an edited transcript) is translated again.
 *
 * Usage: translating an item into a language counts as one AI generation per
 * month, however many chunks it has.
 */

export type TranslationKind = "transcript" | "guide" | "note";
const kindInput = z.enum(["transcript", "guide", "note"]);
const LANGUAGE_CODES = TRANSCRIPTION_LANGUAGES.map((language) => language.code) as [string, ...string[]];

export function languageName(code: string) {
  const language = TRANSCRIPTION_LANGUAGES.find((candidate) => candidate.code === code);
  return language ? language.label.replace(/ \(.*\)/, "") : null;
}

type Source = { title: string; recordingId: number | null; chunks: TranslationChunk[] };

async function loadSource(userId: number, kind: TranslationKind, id: number): Promise<Source> {
  if (kind === "transcript") {
    const recording = await getRecordingById(id);
    if (!recording || recording.userId !== userId || recording.isDeleted) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
    const transcript = await getTranscriptByRecordingId(id);
    if (!transcript?.fullText?.trim()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This recording has no transcript to translate yet." });
    return { title: recording.title, recordingId: id, chunks: chunkTranscript(transcript.fullText, transcript.segments ?? []) };
  }
  if (kind === "guide") {
    const guide = await getStudyGuideById(id);
    if (!guide || guide.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Study guide not found" });
    if (!guide.content?.trim()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This study guide is still being written." });
    return { title: guide.title, recordingId: guide.recordingId, chunks: chunkMarkdown(guide.content) };
  }
  const note = await getStudyNoteById(id);
  if (!note || note.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
  return { title: "Notes", recordingId: note.recordingId, chunks: chunkMarkdown(note.content) };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

async function storedChunks(userId: number, kind: TranslationKind, itemId: number, language: string) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "translations",
    () => db.select().from(translations).where(and(eq(translations.userId, userId), eq(translations.kind, kind), eq(translations.itemId, itemId), eq(translations.language, language))),
    [] as Array<typeof translations.$inferSelect>,
  );
}

/** What the client renders for a chunk: translated lines (with the source times and speakers) or translated text. */
function present(chunk: TranslationChunk, content: string | null) {
  const base = { index: chunk.index, lines: chunk.lines?.map(({ start, speaker }) => ({ start, speaker })) ?? null };
  if (content === null) return { ...base, translatedLines: null, translation: null };
  if (chunk.lines) {
    try {
      const parsed = JSON.parse(content) as { lines?: string[]; text?: string };
      if (Array.isArray(parsed.lines)) return { ...base, translatedLines: parsed.lines, translation: null };
      return { ...base, lines: null, translatedLines: null, translation: parsed.text ?? "" };
    } catch {
      return { ...base, lines: null, translatedLines: null, translation: content };
    }
  }
  return { ...base, translatedLines: null, translation: content };
}

const LINES_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "translated_lines",
    strict: true,
    schema: { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false },
  },
};

/** Translates one chunk. Lines are translated one for one; if the model does not keep the count, the chunk is translated as text. */
export async function translateChunk(chunk: TranslationChunk, languageLabel: string, kind: TranslationKind): Promise<string> {
  const maxTokens = Math.min(4000, Math.ceil(chunk.text.length / 2) + 400);
  if (chunk.lines) {
    const parsed = await completeJson({
      messages: [
        { role: "system", content: `Translate each line of a lecture or meeting transcript into ${languageLabel}. Return JSON {"lines": [...]} with exactly one translated line for each input line, in the same order. Keep names, numbers and technical terms accurate. Do not merge, split, add or drop lines.` },
        { role: "user", content: JSON.stringify({ lines: chunk.lines.map((line) => line.text) }) },
      ],
      responseFormat: LINES_FORMAT,
      maxTokens,
      what: "translation",
    }).catch(() => null);
    const lines = parseTranslatedLines(parsed, chunk.lines.length);
    if (lines) return JSON.stringify({ lines });
    const text = await completeText({
      messages: [
        { role: "system", content: `Translate this transcript passage into ${languageLabel}. Keep names, numbers and technical terms accurate. Return only the translation.` },
        { role: "user", content: chunk.text },
      ],
      maxTokens,
      what: "translation",
    });
    return JSON.stringify({ text });
  }
  return completeText({
    messages: [
      {
        role: "system",
        content: `Translate the user's Markdown ${kind === "guide" ? "study guide" : kind === "note" ? "study notes" : "text"} into ${languageLabel}. This is one part of a longer document. Keep the Markdown structure, headings, lists, formulas, names and numbers exactly. Return only the translation.`,
      },
      { role: "user", content: chunk.text },
    ],
    maxTokens,
    what: "translation",
  });
}

async function hasUsage(dedupeKey: string) {
  const db = await requireDb();
  const rows = await tolerateMissingSchema("usage", () => db.select({ id: usageEvents.id }).from(usageEvents).where(eq(usageEvents.dedupeKey, dedupeKey)).limit(1), []);
  return rows.length > 0;
}

export async function deleteTranslationsForRecordings(recordingIds: number[]) {
  if (!recordingIds.length) return;
  const db = await requireDb();
  await tolerateMissingSchema("translations", () => db.delete(translations).where(inArray(translations.recordingId, recordingIds)), undefined);
}

export async function deleteTranslationsForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema("translations", () => db.delete(translations).where(eq(translations.userId, userId)), undefined);
}

export async function exportTranslationsForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "translations",
    async () =>
      (await db.select().from(translations).where(eq(translations.userId, userId))).map(({ sourceHash, ...row }) => row),
    [] as Array<Omit<typeof translations.$inferSelect, "sourceHash">>,
  );
}

const itemInput = z.object({ kind: kindInput, id: z.number().int().positive(), language: z.enum(LANGUAGE_CODES) });

export const translationsRouter = router({
  /** The chunks of an item, with any translations already stored for this language. */
  get: protectedProcedure.input(itemInput).query(async ({ ctx, input }) => {
    const source = await loadSource(ctx.user.id, input.kind, input.id);
    const stored = await storedChunks(ctx.user.id, input.kind, input.id, input.language);
    const byIndex = new Map(stored.map((row) => [row.chunkIndex, row]));
    return {
      title: source.title,
      language: input.language,
      languageName: languageName(input.language),
      total: source.chunks.length,
      chunks: source.chunks.map((chunk) => {
        const row = byIndex.get(chunk.index);
        return present(chunk, row && row.sourceHash === chunk.hash ? row.content : null);
      }),
    };
  }),

  /** Translates one chunk (or returns the stored one) and saves it. */
  translateChunk: protectedProcedure.input(itemInput.extend({ index: z.number().int().min(0) })).mutation(async ({ ctx, input }) => {
    if (!checkTrpcRateLimit(`translate:${ctx.user.id}`, 10 * 60 * 1000, 200)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of translating in a short time. Give it a few minutes." });
    }
    const label = languageName(input.language)!;
    const source = await loadSource(ctx.user.id, input.kind, input.id);
    const chunk = source.chunks[input.index];
    if (!chunk) throw new TRPCError({ code: "BAD_REQUEST", message: "That part no longer exists. Reopen the translation." });

    const db = await requireDb();
    const [existing] = await explainMissingSchema("Saved translations", () =>
      db.select().from(translations).where(and(eq(translations.kind, input.kind), eq(translations.itemId, input.id), eq(translations.language, input.language), eq(translations.chunkIndex, input.index))).limit(1),
    );
    if (existing && existing.userId === ctx.user.id && existing.sourceHash === chunk.hash) return present(chunk, existing.content);

    // One generation per item and language per month, charged on the first chunk translated.
    const dedupeKey = `translate:${input.kind}:${input.id}:${input.language}:${usagePeriod()}`;
    const charged = await hasUsage(dedupeKey);
    if (!charged) await assertCanGenerate(ctx.user);

    const content = await translateChunk(chunk, label, input.kind);
    const values = { userId: ctx.user.id, kind: input.kind, itemId: input.id, recordingId: source.recordingId, language: input.language, chunkIndex: input.index, sourceHash: chunk.hash, content };
    await db.insert(translations).values(values).onDuplicateKeyUpdate({ set: { sourceHash: chunk.hash, content, userId: ctx.user.id } });
    if (!charged) await recordUsage({ userId: ctx.user.id, kind: "ai_generation", units: 1, recordingId: source.recordingId, dedupeKey });
    return present(chunk, content);
  }),
});
