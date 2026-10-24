import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  studySourceFlags, studySourceParts, studySourceUnits, studySources,
  type StudySource,
} from "../drizzle/schema";
import {
  MAX_SOURCE_BYTES_PER_USER, MAX_SOURCES_PER_COURSE, MAX_SOURCES_PER_USER, sourceKindForFileName,
} from "@shared/const";
import { describeAiFailure } from "./aiErrors";
import { getOwnCourse } from "./courses";
import { getDb } from "./db";
import { completeJson, completeText } from "./llmJson";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import {
  PDF_BUDGET_MS, SourceExtractError, extractSource, maxBytesForKind,
} from "./sourceExtract";
import {
  ANALYSIS_RESPONSE_FORMAT, FLAG_KINDS, MAX_FLAGS_PER_PART, MAX_FLAGS_PER_SOURCE, buildAnalysisMessages, buildAnalysisRetryMessages,
  buildSummaryMessages, capFlags, cleanSummary, fallbackSummary, parseAnalysis,
} from "./sourceFlags";
import { planParts } from "./sourceParts";
import { parseJsonContent } from "./studyExtraction";
import { createDirectSourceUpload, deleteStoredAudio, isVercelBlobStorageConfigured, storageGetSignedUrl, verifyUploadedSource } from "./storage";
import { storageHasRoomForSlides } from "./slides";
import { assertCanGenerate, hasUsage, recordUsage } from "./usage";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Study sources (Phase 8): a student's PDFs, slides and notes, per course.
 *
 * The browser drives the pipeline one request at a time, so none comes near
 * the 60s function limit: prepareUpload, a direct PUT to Blob, register,
 * extract, analyzePart for each part (two at a time), finalize. Every step is
 * idempotent and the stored progress (`get`) lets a reload carry on. The
 * original file is never served or linked; only extracted text is shown.
 *
 * Migration 0034 is applied by hand: reads treat the missing tables as "no
 * sources", writes explain themselves.
 */

const FEATURE = "study sources";
const FEATURE_NAME = "Study sources";
const TEN_MINUTES = 10 * 60 * 1000;
/** An `extracting` source older than this was abandoned by a request that died. */
const EXTRACT_STALE_MS = 2 * 60 * 1000;
const PART_TIMEOUT_MS = 40_000;
const SUMMARY_TIMEOUT_MS = 30_000;
/** Time one analyzePart may spend on model calls, and the least worth starting a retry with. */
const PART_BUDGET_MS = 52_000;
const MIN_RETRY_MS = 8_000;

const idInput = z.object({ id: z.number().int().positive() });

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}
type Db = Awaited<ReturnType<typeof requireDb>>;

function limit(bucket: "upload" | "register" | "extract" | "analyze", userId: number, max: number) {
  if (!checkTrpcRateLimit(`source-${bucket}:${userId}`, TEN_MINUTES, max)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of uploads in a short time. Give it a few minutes." });
  }
}

// Ten minutes per person. A file takes one register, one extract and up to ~60 analyzePart calls, so each step
// has its own bucket and a batch of files cannot starve a later step of an earlier file.
const LIMITS = { upload: 20, register: 40, extract: 40, analyze: 400 };

/** The list and detail shape the app shows. Never includes the storage key or the content hash. */
function publicSource(row: StudySource) {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    kind: row.kind,
    status: row.status,
    courseId: row.courseId,
    sizeBytes: row.sizeBytes,
    unitCount: row.unitCount,
    charCount: row.charCount,
    partCount: row.partCount,
    partsDone: row.partsDone,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadOwned(db: Db, userId: number, id: number): Promise<StudySource> {
  const [row] = await tolerateMissingSchema(
    FEATURE,
    () => db.select().from(studySources).where(and(eq(studySources.id, id), eq(studySources.userId, userId))).limit(1),
    [] as StudySource[],
  );
  // The query already filters by owner; checking again means a mistake there can never expose someone else's source.
  if (!row || row.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Study source not found" });
  return row;
}

/** The person's own, active course, or an error. */
async function requireOwnCourse(userId: number, courseId: number) {
  const course = await getOwnCourse(courseId, userId);
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  if (course.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "That course is archived. Restore it before adding material." });
}

async function assertQuota(db: Db, userId: number, courseId: number | null, addBytes: number) {
  await explainMissingSchema(FEATURE_NAME, async () => {
    const [totals] = await db
      .select({ count: sql<string>`COUNT(*)`, bytes: sql<string>`COALESCE(SUM(${studySources.sizeBytes}), 0)` })
      .from(studySources)
      .where(eq(studySources.userId, userId));
    if (Number(totals?.count ?? 0) >= MAX_SOURCES_PER_USER) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `You can keep up to ${MAX_SOURCES_PER_USER} study sources. Delete one you no longer need first.` });
    }
    if (Number(totals?.bytes ?? 0) + addBytes > MAX_SOURCE_BYTES_PER_USER) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You have reached the storage limit for study sources. Delete one you no longer need first." });
    }
    if (courseId !== null) {
      const [inCourse] = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(studySources)
        .where(and(eq(studySources.userId, userId), eq(studySources.courseId, courseId)));
      if (Number(inCourse?.count ?? 0) >= MAX_SOURCES_PER_COURSE) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A course can hold up to ${MAX_SOURCES_PER_COURSE} study sources.` });
      }
    }
  });
}

function titleFromFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled").slice(0, 200);
}

const KEY_PATTERN = /^(\d+)\/sources\/[0-9a-f-]{36}-(pdf|pptx|docx|text)\.bin$/;

async function loadUnits(db: Db, userId: number, sourceId: number) {
  return db
    .select({ unitIndex: studySourceUnits.unitIndex, label: studySourceUnits.label, text: studySourceUnits.text })
    .from(studySourceUnits)
    .where(and(eq(studySourceUnits.sourceId, sourceId), eq(studySourceUnits.userId, userId)))
    .orderBy(asc(studySourceUnits.unitIndex));
}

async function countParts(db: Pick<Db, "select">, sourceId: number) {
  const [row] = await db.select({ count: sql<string>`COUNT(*)` }).from(studySourceParts).where(eq(studySourceParts.sourceId, sourceId));
  return Number(row?.count ?? 0);
}

async function readStoredSource(key: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(await storageGetSignedUrl(key), { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`storage returned ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new SourceExtractError("That file is larger than the size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new SourceExtractError("That file is larger than the size limit.");
  return bytes;
}

async function deleteRowsForSources(db: Db, where: { ids?: number[]; userId?: number }) {
  const match = <T extends { sourceId: any; userId: any }>(table: T) =>
    where.ids ? inArray(table.sourceId, where.ids) : eq(table.userId, where.userId!);
  await db.delete(studySourceFlags).where(match(studySourceFlags));
  await db.delete(studySourceParts).where(match(studySourceParts));
  await db.delete(studySourceUnits).where(match(studySourceUnits));
  if (where.ids) await db.delete(studySources).where(inArray(studySources.id, where.ids));
  else await db.delete(studySources).where(eq(studySources.userId, where.userId!));
}

/** The extract step; returns nothing, throws on failure (the caller records it). */
async function runExtraction(db: Db, source: StudySource) {
  const started = Date.now();
  const bytes = await readStoredSource(source.storageKey, maxBytesForKind(source.kind));
  const { kind, units } = await extractSource(source.fileName, bytes, { deadlineMs: Math.max(5_000, PDF_BUDGET_MS - (Date.now() - started)) });
  if (kind !== source.kind) throw new SourceExtractError("This file does not match the type it was uploaded as.");

  await db.delete(studySourceFlags).where(eq(studySourceFlags.sourceId, source.id));
  await db.delete(studySourceParts).where(eq(studySourceParts.sourceId, source.id));
  await db.delete(studySourceUnits).where(eq(studySourceUnits.sourceId, source.id));
  for (let i = 0; i < units.length; i += 100) {
    await db.insert(studySourceUnits).values(
      units.slice(i, i + 100).map((unit, offset) => ({ sourceId: source.id, userId: source.userId, unitIndex: i + offset, label: unit.label, text: unit.text })),
    );
  }
  const planned = planParts(units.map((unit, unitIndex) => ({ unitIndex, label: unit.label, text: unit.text })));
  const contentHash = createHash("sha256").update(units.map(unit => unit.text).join("\n\u0000\n")).digest("hex");
  await db
    .update(studySources)
    .set({
      status: "extracted",
      unitCount: units.length,
      charCount: units.reduce((sum, unit) => sum + unit.text.length, 0),
      partCount: planned.length,
      partsDone: 0,
      errorMessage: null,
      summary: null,
      contentHash,
    })
    .where(eq(studySources.id, source.id));
}

/** One analysis call with a single retry as plain text when the structured answer is unusable. */
async function analyzeText(partText: string, units: Parameters<typeof parseAnalysis>[1], maxFlags: number) {
  const started = Date.now();
  const first = await completeJson({
    messages: buildAnalysisMessages(partText),
    responseFormat: ANALYSIS_RESPONSE_FORMAT,
    maxTokens: 1100,
    timeoutMs: PART_TIMEOUT_MS,
    what: "analysis of this file",
  }).catch(error => {
    // Only an unreadable answer is retried; provider trouble is reported as it is.
    if (error instanceof TRPCError && /came back unreadable/i.test(error.message)) return null;
    throw error;
  });
  const parsed = parseAnalysis(first, units, { maxFlags });
  if (parsed.valid) return parsed;

  // The whole request has to end inside the 60s function limit, so the retry gets what is left of the budget.
  const unreadable = () => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The assistant's analysis of this file came back unreadable. Try again." });
  const remaining = Math.min(PART_TIMEOUT_MS, PART_BUDGET_MS - (Date.now() - started));
  if (remaining < MIN_RETRY_MS) throw unreadable();
  const text = await completeText({ messages: buildAnalysisRetryMessages(partText), maxTokens: 1100, timeoutMs: remaining, what: "analysis of this file" });
  const retried = parseAnalysis(parseJsonContent(text), units, { maxFlags });
  if (!retried.valid) throw unreadable();
  return retried;
}

/** Provider trouble reads the same everywhere (see aiErrors.ts); other errors keep their own message. */
function explainAiFailure(error: unknown): never {
  const failure = describeAiFailure(error);
  if (failure) throw new TRPCError({ code: failure.code, message: failure.message, cause: error });
  throw error;
}

export const sourcesRouter = router({
  /** Everything the library shows. `available: false` means migration 0034 has not been applied. */
  list: protectedProcedure.input(z.object({ courseId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const where = input?.courseId !== undefined ? and(eq(studySources.userId, ctx.user.id), eq(studySources.courseId, input.courseId)) : eq(studySources.userId, ctx.user.id);
    const rows = await tolerateMissingSchema<StudySource[] | null>(FEATURE, () => db.select().from(studySources).where(where).orderBy(desc(studySources.createdAt), desc(studySources.id)), null);
    if (rows === null) return { available: false, sources: [] as Array<ReturnType<typeof publicSource> & { flagCount: number }> };
    const counts = rows.length
      ? await db
          .select({ sourceId: studySourceFlags.sourceId, total: sql<string>`COUNT(*)` })
          .from(studySourceFlags)
          .where(and(eq(studySourceFlags.userId, ctx.user.id), inArray(studySourceFlags.sourceId, rows.map(row => row.id))))
          .groupBy(studySourceFlags.sourceId)
      : [];
    const byId = new Map(counts.map(row => [row.sourceId, Number(row.total)]));
    return { available: true, sources: rows.map(row => ({ ...publicSource(row), flagCount: byId.get(row.id) ?? 0 })) };
  }),

  /** One source with its summary, unit labels, per-part progress and flags. */
  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    const [units, parts, flags] = await Promise.all([
      db
        .select({ unitIndex: studySourceUnits.unitIndex, label: studySourceUnits.label })
        .from(studySourceUnits)
        .where(and(eq(studySourceUnits.sourceId, source.id), eq(studySourceUnits.userId, ctx.user.id)))
        .orderBy(asc(studySourceUnits.unitIndex)),
      db
        .select({ partIndex: studySourceParts.partIndex, unitStart: studySourceParts.unitStart, unitEnd: studySourceParts.unitEnd })
        .from(studySourceParts)
        .where(and(eq(studySourceParts.sourceId, source.id), eq(studySourceParts.userId, ctx.user.id))),
      db
        .select({
          id: studySourceFlags.id,
          unitIndex: studySourceFlags.unitIndex,
          label: studySourceFlags.label,
          kind: studySourceFlags.kind,
          text: studySourceFlags.text,
          quote: studySourceFlags.quote,
          importance: studySourceFlags.importance,
        })
        .from(studySourceFlags)
        .where(and(eq(studySourceFlags.sourceId, source.id), eq(studySourceFlags.userId, ctx.user.id)))
        .orderBy(asc(studySourceFlags.unitIndex), desc(studySourceFlags.importance), asc(studySourceFlags.id)),
    ]);
    const done = new Map(parts.map(part => [part.partIndex, part]));
    return {
      source: { ...publicSource(source), summary: source.summary },
      units,
      parts: Array.from({ length: source.partCount }, (_, index) => ({
        index,
        done: done.has(index),
        unitStart: done.get(index)?.unitStart ?? null,
        unitEnd: done.get(index)?.unitEnd ?? null,
      })),
      flags,
    };
  }),

  /** The text of one page, slide or section, for the viewer and for citations. */
  getUnit: protectedProcedure.input(z.object({ id: z.number().int().positive(), unitIndex: z.number().int().min(0) })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    const [unit] = await db
      .select({ unitIndex: studySourceUnits.unitIndex, label: studySourceUnits.label, text: studySourceUnits.text })
      .from(studySourceUnits)
      .where(and(eq(studySourceUnits.sourceId, source.id), eq(studySourceUnits.userId, ctx.user.id), eq(studySourceUnits.unitIndex, input.unitIndex)))
      .limit(1);
    if (!unit) throw new TRPCError({ code: "NOT_FOUND", message: "That page was not found." });
    return { ...unit, unitCount: source.unitCount };
  }),

  /** Test-relevant details across sources (the "Likely on a test" view). */
  flags: protectedProcedure
    .input(z.object({
      courseId: z.number().int().positive().optional(),
      kinds: z.array(z.enum(FLAG_KINDS)).max(FLAG_KINDS.length).optional(),
      minImportance: z.number().int().min(1).max(3).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      return tolerateMissingSchema(
        FEATURE,
        () =>
          db
            .select({
              id: studySourceFlags.id,
              sourceId: studySourceFlags.sourceId,
              sourceTitle: studySources.title,
              courseId: studySources.courseId,
              unitIndex: studySourceFlags.unitIndex,
              label: studySourceFlags.label,
              kind: studySourceFlags.kind,
              text: studySourceFlags.text,
              quote: studySourceFlags.quote,
              importance: studySourceFlags.importance,
            })
            .from(studySourceFlags)
            .innerJoin(studySources, eq(studySources.id, studySourceFlags.sourceId))
            .where(
              and(
                eq(studySourceFlags.userId, ctx.user.id),
                eq(studySources.userId, ctx.user.id),
                input?.courseId !== undefined ? eq(studySources.courseId, input.courseId) : undefined,
                input?.kinds?.length ? inArray(studySourceFlags.kind, input.kinds) : undefined,
                input?.minImportance ? gte(studySourceFlags.importance, input.minImportance) : undefined,
              ),
            )
            .orderBy(desc(studySourceFlags.importance), asc(studySourceFlags.sourceId), asc(studySourceFlags.unitIndex))
            .limit(500),
        [],
      );
    }),

  /** Step 1: a signed one-shot upload URL for the file. */
  prepareUpload: protectedProcedure
    .input(z.object({ fileName: z.string().trim().min(1).max(255), size: z.number().int().positive(), courseId: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      limit("upload", ctx.user.id, LIMITS.upload);
      if (/\.(doc|ppt)$/i.test(input.fileName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Old .doc and .ppt files are not supported. Save it as .docx or .pptx and upload that." });
      }
      const kind = sourceKindForFileName(input.fileName);
      if (!kind) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload a PDF, PowerPoint (.pptx), Word (.docx), .txt or .md file." });
      if (input.size > maxBytesForKind(kind)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: kind === "text" ? "Text and Markdown files can be up to 2MB." : "Files can be up to 25MB." });
      }
      if (!isVercelBlobStorageConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File storage is not set up on this server yet." });
      if (input.courseId !== undefined) await requireOwnCourse(ctx.user.id, input.courseId);
      await assertQuota(await requireDb(), ctx.user.id, input.courseId ?? null, input.size);
      // Documents must never crowd out lecture audio in the shared store.
      if (!(await storageHasRoomForSlides())) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is nearly full, so uploads are paused. Your existing material is safe." });
      }
      const upload = await createDirectSourceUpload({ userId: ctx.user.id, fileName: input.fileName, size: input.size });
      if (!upload) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File storage is not set up on this server yet." });
      return upload;
    }),

  /** Step 2: after the PUT, confirm the object and create the row. */
  register: protectedProcedure
    .input(z.object({
      key: z.string().min(1).max(300),
      fileName: z.string().trim().min(1).max(255),
      courseId: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      limit("register", ctx.user.id, LIMITS.register);
      const keyMatch = KEY_PATTERN.exec(input.key);
      if (!keyMatch || Number(keyMatch[1]) !== ctx.user.id || !input.key.startsWith(`${ctx.user.id}/sources/`)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That upload does not belong to you." });
      }
      const db = await requireDb();
      // A client that lost the response retries with the same key: answer with the row that owns it, and never
      // touch its file (the quota check below would count that row again, and a failure would delete its blob).
      const owned = async () => {
        const [existing] = await explainMissingSchema(FEATURE_NAME, () =>
          db.select({ id: studySources.id }).from(studySources).where(and(eq(studySources.storageKey, input.key), eq(studySources.userId, ctx.user.id))).limit(1),
        );
        return existing ? { id: existing.id } : null;
      };
      const already = await owned();
      if (already) return already;

      const kind = sourceKindForFileName(input.fileName);
      const discard = () => deleteStoredAudio([input.key]).catch(() => undefined);
      if (!kind || kind !== keyMatch[2]) {
        await discard();
        throw new TRPCError({ code: "BAD_REQUEST", message: "That file does not match the type it was prepared as. Upload it again." });
      }
      let size: number;
      try {
        ({ size } = await verifyUploadedSource(input.key));
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The uploaded file could not be found." });
      }
      try {
        if (size > maxBytesForKind(kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is larger than the size limit." });
        if (input.courseId !== undefined) await requireOwnCourse(ctx.user.id, input.courseId);
        await assertQuota(db, ctx.user.id, input.courseId ?? null, size);
        try {
          const [result] = await explainMissingSchema(FEATURE_NAME, () =>
            db.insert(studySources).values({
              userId: ctx.user.id,
              courseId: input.courseId ?? null,
              title: input.title ?? titleFromFileName(input.fileName),
              fileName: input.fileName.slice(0, 255),
              kind,
              storageKey: input.key,
              sizeBytes: size,
              status: "uploaded",
            }),
          );
          return { id: Number((result as { insertId: number }).insertId) };
        } catch (error) {
          // Two requests raced on the same key: the other one's row owns the file.
          if (isDuplicateKey(error)) {
            const winner = await owned();
            if (winner) return winner;
          }
          throw error;
        }
      } catch (error) {
        // A file that will never get a row must not keep counting against storage, unless a row owns it.
        if (!(await owned().catch(() => null))) await discard();
        throw error;
      }
    }),

  /** Step 3: read the file and store its text. A failure is recorded on the source (and can be retried), not thrown. */
  extract: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    limit("extract", ctx.user.id, LIMITS.extract);
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    if (source.status === "extracting" && Date.now() - new Date(source.updatedAt).getTime() < EXTRACT_STALE_MS) return publicSource(source);
    if (source.status !== "uploaded" && source.status !== "extracting") return publicSource(source);

    // Claim it; if another request got there first, report the state it left.
    const [claim] = await db
      .update(studySources)
      .set({ status: "extracting", errorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(studySources.id, source.id),
          eq(studySources.userId, ctx.user.id),
          eq(studySources.status, source.status),
          // A stale "extracting" row can be reclaimed by one request only: the winner changes updatedAt.
          eq(studySources.updatedAt, source.updatedAt),
        ),
      );
    if (Number((claim as { affectedRows?: number } | undefined)?.affectedRows ?? 1) === 0) return publicSource(await loadOwned(db, ctx.user.id, source.id));

    try {
      await runExtraction(db, source);
    } catch (error) {
      const message = error instanceof SourceExtractError ? error.message : "We could not read this file. It may be damaged. Try uploading it again.";
      if (!(error instanceof SourceExtractError)) console.error(`[sources] extraction of ${source.id} failed:`, error instanceof Error ? error.message : error);
      await db.update(studySources).set({ status: "failed", errorMessage: message.slice(0, 300) }).where(eq(studySources.id, source.id));
    }
    return publicSource(await loadOwned(db, ctx.user.id, source.id));
  }),

  /** Step 4 (once per part): summarise one part and flag its test-relevant details. Safe to repeat. */
  analyzePart: protectedProcedure.input(z.object({ id: z.number().int().positive(), index: z.number().int().min(0) })).mutation(async ({ ctx, input }) => {
    limit("analyze", ctx.user.id, LIMITS.analyze);
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    if (source.status === "uploaded" || source.status === "extracting" || source.status === "failed") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This file has not been read yet." });
    }
    const plan = planParts((await loadUnits(db, ctx.user.id, source.id)));
    const part = plan[input.index];
    if (!part) throw new TRPCError({ code: "BAD_REQUEST", message: "That part no longer exists. Reload the page." });

    const [stored] = await db
      .select()
      .from(studySourceParts)
      .where(and(eq(studySourceParts.sourceId, source.id), eq(studySourceParts.partIndex, part.index)))
      .limit(1);
    if (stored && stored.inputHash === part.hash) {
      return { index: part.index, done: true as const, partsDone: await countParts(db, source.id), partCount: plan.length };
    }

    // The whole source is one AI generation per month, charged on its first part.
    const dedupeKey = `source:${source.id}`;
    const charged = await hasUsage(dedupeKey);
    if (!charged) await assertCanGenerate(ctx.user);

    if (source.status === "extracted") {
      await db.update(studySources).set({ status: "analyzing" }).where(and(eq(studySources.id, source.id), eq(studySources.status, "extracted")));
    }

    let analysis;
    try {
      analysis = await analyzeText(part.text, part.units, MAX_FLAGS_PER_PART);
    } catch (error) {
      explainAiFailure(error);
    }

    // Replace the part's flags and record it in one transaction, holding the source row so parts of one source
    // (and a repeat of the same part) take turns: no duplicate flags, and the per-source cap counts what is really there.
    const partsDone = await db.transaction(async tx => {
      await tx.select({ id: studySources.id }).from(studySources).where(eq(studySources.id, source.id)).for("update");
      await tx.delete(studySourceFlags).where(and(eq(studySourceFlags.sourceId, source.id), eq(studySourceFlags.partIndex, part.index)));
      const [others] = await tx.select({ count: sql<string>`COUNT(*)` }).from(studySourceFlags).where(eq(studySourceFlags.sourceId, source.id));
      const flags = capFlags(analysis.flags, MAX_FLAGS_PER_SOURCE - Number(others?.count ?? 0));
      if (flags.length) {
        await tx.insert(studySourceFlags).values(
          flags.map(flag => ({
            sourceId: source.id,
            userId: ctx.user.id,
            partIndex: part.index,
            unitIndex: flag.unitIndex,
            label: flag.label,
            kind: flag.kind,
            text: flag.text,
            quote: flag.quote,
            importance: flag.importance,
          })),
        );
      }
      const ideas = JSON.stringify(analysis.ideas);
      await tx
        .insert(studySourceParts)
        .values({ sourceId: source.id, userId: ctx.user.id, partIndex: part.index, unitStart: part.unitStart, unitEnd: part.unitEnd, inputHash: part.hash, ideas })
        .onDuplicateKeyUpdate({ set: { inputHash: part.hash, ideas, unitStart: part.unitStart, unitEnd: part.unitEnd, userId: ctx.user.id } });
      const done = await countParts(tx, source.id);
      await tx.update(studySources).set({ partsDone: done }).where(eq(studySources.id, source.id));
      return done;
    });
    if (!charged) await recordUsage({ userId: ctx.user.id, kind: "ai_generation", units: 1, dedupeKey });
    return { index: part.index, done: true as const, partsDone, partCount: plan.length };
  }),

  /** Step 5: once every part is analysed, write the "Main ideas" summary and mark the source ready. */
  finalize: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    limit("analyze", ctx.user.id, LIMITS.analyze);
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    if (source.status === "ready") return publicSource(source);
    if (source.status === "uploaded" || source.status === "extracting" || source.status === "failed") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This file has not been read yet." });
    }
    const parts = await db
      .select({ partIndex: studySourceParts.partIndex, ideas: studySourceParts.ideas })
      .from(studySourceParts)
      .where(and(eq(studySourceParts.sourceId, source.id), eq(studySourceParts.userId, ctx.user.id)))
      .orderBy(asc(studySourceParts.partIndex));
    if (source.partCount === 0 || parts.length < source.partCount) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Some parts of this file have not been summarised yet." });
    }

    const dedupeKey = `source:${source.id}`;
    const charged = await hasUsage(dedupeKey);
    if (!charged) await assertCanGenerate(ctx.user);

    const ideasByPart = parts.map(part => {
      try {
        const parsed = JSON.parse(part.ideas);
        return Array.isArray(parsed) ? parsed.filter((idea): idea is string => typeof idea === "string") : [];
      } catch {
        return [];
      }
    });
    const allIdeas = ideasByPart.flat().slice(0, 60);
    let summary: string;
    try {
      if (allIdeas.length === 0) throw new Error("no ideas");
      summary = cleanSummary(await completeText({ messages: buildSummaryMessages(source.title, allIdeas), maxTokens: 600, timeoutMs: SUMMARY_TIMEOUT_MS, what: "summary" }));
      if (!summary) throw new Error("empty summary");
    } catch (error) {
      console.warn(`[sources] summary for ${source.id} fell back to the part ideas:`, error instanceof Error ? error.message : error);
      summary = fallbackSummary(ideasByPart);
    }
    await db.update(studySources).set({ status: "ready", summary, partsDone: parts.length, errorMessage: null }).where(eq(studySources.id, source.id));
    if (!charged) await recordUsage({ userId: ctx.user.id, kind: "ai_generation", units: 1, dedupeKey });
    return publicSource(await loadOwned(db, ctx.user.id, source.id));
  }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(200).optional(), courseId: z.number().int().positive().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const source = await loadOwned(db, ctx.user.id, input.id);
      const changes: Partial<typeof studySources.$inferInsert> = {};
      if (input.title !== undefined) changes.title = input.title;
      if (input.courseId !== undefined) {
        if (input.courseId !== null && input.courseId !== source.courseId) {
          await requireOwnCourse(ctx.user.id, input.courseId);
          const [inCourse] = await db
            .select({ count: sql<string>`COUNT(*)` })
            .from(studySources)
            .where(and(eq(studySources.userId, ctx.user.id), eq(studySources.courseId, input.courseId)));
          if (Number(inCourse?.count ?? 0) >= MAX_SOURCES_PER_COURSE) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `A course can hold up to ${MAX_SOURCES_PER_COURSE} study sources.` });
          }
        }
        changes.courseId = input.courseId;
      }
      if (Object.keys(changes).length > 0) {
        await db.update(studySources).set(changes).where(and(eq(studySources.id, source.id), eq(studySources.userId, ctx.user.id)));
      }
      return publicSource(await loadOwned(db, ctx.user.id, source.id));
    }),

  /** Deletes the stored file first (a failure stops here, so nothing is orphaned), then the rows. */
  remove: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    try {
      await deleteStoredAudio([source.storageKey]);
    } catch (error) {
      console.error(`[sources] could not delete the file of ${source.id}:`, error instanceof Error ? error.message : error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The file could not be removed from storage, so nothing was deleted. Try again in a moment." });
    }
    await deleteRowsForSources(db, { ids: [source.id] });
    return { removed: true as const };
  }),

  /** A failed source goes back to `uploaded` with its parts and flags cleared, ready for `extract`. */
  retry: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    limit("extract", ctx.user.id, LIMITS.extract);
    const db = await requireDb();
    const source = await loadOwned(db, ctx.user.id, input.id);
    if (source.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a file that failed can be retried." });
    await db.delete(studySourceFlags).where(eq(studySourceFlags.sourceId, source.id));
    await db.delete(studySourceParts).where(eq(studySourceParts.sourceId, source.id));
    await db.delete(studySourceUnits).where(eq(studySourceUnits.sourceId, source.id));
    await db
      .update(studySources)
      .set({ status: "uploaded", errorMessage: null, unitCount: 0, charCount: 0, partCount: 0, partsDone: 0, summary: null })
      .where(eq(studySources.id, source.id));
    return publicSource(await loadOwned(db, ctx.user.id, source.id));
  }),
});

function isDuplicateKey(error: unknown) {
  for (let current: any = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current.code === "ER_DUP_ENTRY" || current.errno === 1062) return true;
  }
  return false;
}

// ------------------------------------------------------------ purge, export, detach

/**
 * Account deletion: the stored files go first and a failure stops everything
 * (a file with no row pointing at it would count against storage forever),
 * then the rows of all four tables.
 */
export async function deleteSourcesForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  const rows = await tolerateMissingSchema(
    FEATURE,
    () => db.select({ storageKey: studySources.storageKey }).from(studySources).where(eq(studySources.userId, userId)),
    null as Array<{ storageKey: string }> | null,
  );
  if (rows === null) return;
  if (rows.length) await deleteStoredAudio(rows.map(row => row.storageKey));
  await tolerateMissingSchema(FEATURE, () => deleteRowsForSources(db, { userId }), undefined);
}

/** Account export: sources (without storage keys or hashes), their text and flags. Parts are internal and omitted. */
export async function exportSourcesForUser(userId: number) {
  const db = await getDb();
  const none = { sources: [], units: [], flags: [] };
  if (!db) return none;
  return tolerateMissingSchema(
    FEATURE,
    async () => {
      const sources = (await db.select().from(studySources).where(eq(studySources.userId, userId))).map(({ storageKey, contentHash, ...row }) => row);
      const units = (await db.select().from(studySourceUnits).where(eq(studySourceUnits.userId, userId))).map(({ userId: _owner, ...row }) => row);
      const flags = (await db.select().from(studySourceFlags).where(eq(studySourceFlags.userId, userId))).map(({ userId: _owner, ...row }) => row);
      return { sources, units, flags };
    },
    none as { sources: Array<Omit<StudySource, "storageKey" | "contentHash">>; units: Array<Omit<typeof studySourceUnits.$inferSelect, "userId">>; flags: Array<Omit<typeof studySourceFlags.$inferSelect, "userId">> },
  );
}

/** For a course that goes away: its sources stay, just unfiled. */
export async function detachSourcesFromCourse(userId: number, courseId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema(FEATURE, () => db.update(studySources).set({ courseId: null }).where(and(eq(studySources.userId, userId), eq(studySources.courseId, courseId))), undefined);
}
