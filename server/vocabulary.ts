import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { vocabularyLists } from "../drizzle/schema";
import { isMissingTableError } from "./bookmarks";
import { getDb, getRecordingById } from "./db";
import { protectedProcedure, router } from "./_core/trpc";
import { MAX_TERMS_PER_LIST, mergeKeyterms, parseVocabulary, serializeVocabulary } from "./vocabularyInput";

/**
 * Custom vocabulary storage. The vocabularyLists table arrives with migration
 * 0020 (`npm run db:migrate`). Until then nothing is stored, terms given with
 * a single upload are still sent with that upload, and transcription is
 * never held up by any of this.
 */
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function tolerateMissingTable<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[vocabulary] table missing; run `npm run db:migrate` to store custom vocabulary");
      return fallback;
    }
    throw error;
  }
}

function listCondition(userId: number, recordingId: number | null) {
  return recordingId === null
    ? and(eq(vocabularyLists.userId, userId), isNull(vocabularyLists.recordingId))
    : and(eq(vocabularyLists.userId, userId), eq(vocabularyLists.recordingId, recordingId));
}

async function readList(userId: number, recordingId: number | null): Promise<string[]> {
  const db = await requireDb();
  return tolerateMissingTable(async () => {
    const rows = await db.select().from(vocabularyLists).where(listCondition(userId, recordingId)).limit(1);
    return parseVocabulary(rows[0]?.terms ?? "");
  }, []);
}

/** Saves (or with an empty list, clears) a list. Returns false when the table is missing. */
async function writeList(userId: number, recordingId: number | null, terms: string[]): Promise<boolean> {
  const db = await requireDb();
  return tolerateMissingTable(async () => {
    await db.delete(vocabularyLists).where(listCondition(userId, recordingId));
    if (terms.length) await db.insert(vocabularyLists).values({ userId, recordingId, terms: serializeVocabulary(terms) });
    return true;
  }, false);
}

export const getUserVocabulary = (userId: number) => readList(userId, null);
export const getRecordingVocabulary = (userId: number, recordingId: number) => readList(userId, recordingId);

/** Stores the extra terms given with one recording; failures never block the upload. */
export async function rememberRecordingVocabulary(userId: number, recordingId: number, terms: string[] | undefined) {
  if (terms === undefined) return;
  try {
    await writeList(userId, recordingId, parseVocabulary(terms));
  } catch (error) {
    console.warn("[vocabulary] could not store recording terms", recordingId, error instanceof Error ? error.message : error);
  }
}

/**
 * What to send with a transcription job: the recording's own terms (those
 * just given, or the ones stored for it) followed by the person's list.
 */
export async function resolveKeyterms(userId: number, recordingId: number, given?: string[]): Promise<string[]> {
  try {
    const [recordingTerms, userTerms] = await Promise.all([
      given !== undefined ? Promise.resolve(parseVocabulary(given)) : readList(userId, recordingId),
      readList(userId, null),
    ]);
    return mergeKeyterms(recordingTerms, userTerms);
  } catch (error) {
    console.warn("[vocabulary] could not read custom vocabulary", error instanceof Error ? error.message : error);
    return given ? mergeKeyterms(parseVocabulary(given), []) : [];
  }
}

export async function deleteVocabularyForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(vocabularyLists).where(inArray(vocabularyLists.recordingId, recordingIds)), undefined);
}

export async function deleteVocabularyForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(vocabularyLists).where(eq(vocabularyLists.userId, userId)), undefined);
}

export async function exportVocabularyForUser(userId: number) {
  const db = await requireDb();
  const rows = await tolerateMissingTable(() => db.select().from(vocabularyLists).where(eq(vocabularyLists.userId, userId)), []);
  return rows.map(row => ({ recordingId: row.recordingId, terms: parseVocabulary(row.terms), updatedAt: row.updatedAt }));
}

const termsInput = z.string().max(20_000);

export const vocabularyRouter = router({
  /** The person's standing list, plus one recording's extra terms when asked. */
  get: protectedProcedure.input(z.object({ recordingId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
    const terms = await getUserVocabulary(ctx.user.id);
    let recordingTerms: string[] = [];
    if (input?.recordingId) {
      const recording = await getRecordingById(input.recordingId);
      if (!recording || recording.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
      recordingTerms = await getRecordingVocabulary(ctx.user.id, input.recordingId);
    }
    return { terms, recordingTerms, max: MAX_TERMS_PER_LIST };
  }),

  save: protectedProcedure.input(z.object({ terms: termsInput })).mutation(async ({ ctx, input }) => {
    const terms = parseVocabulary(input.terms);
    const saved = await writeList(ctx.user.id, null, terms);
    if (!saved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Custom vocabulary is not set up on this server yet." });
    return { terms };
  }),
});
