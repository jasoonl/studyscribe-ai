import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { notePages, type NotePage } from "../drizzle/schema";
import {
  MAX_NOTE_BODY_CHARS, MAX_NOTE_PAGES_PER_USER, MAX_NOTE_TITLE_CHARS, NOTE_ORGANIZE_MODES, cleanNoteTitle,
} from "@shared/notePages";
import { escapeLike } from "./askRetrieval";
import { getOwnCourse } from "./courses";
import { getDb } from "./db";
import { completeText } from "./llmJson";
import { ORGANIZE_MAX_TOKENS, ORGANIZE_TIMEOUT_MS, buildOrganizeMessages, cleanOrganizedMarkdown } from "./notePagePrompts";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { aiProcedure } from "./usage";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Standalone study notes (Phase 9). Migration 0036 is applied by hand: reads
 * treat the missing table as "no notes", writes explain themselves.
 */
const FEATURE = "notes";
const FEATURE_NAME = "Notes";
const TEN_MINUTES = 10 * 60 * 1000;
const LIMITS = { write: 240, create: 60 };

const idInput = z.object({ id: z.number().int().positive() });
const titleInput = z.string().max(MAX_NOTE_TITLE_CHARS * 2).transform(cleanNoteTitle);
const bodyInput = z.string().max(MAX_NOTE_BODY_CHARS, `Notes can be up to ${MAX_NOTE_BODY_CHARS.toLocaleString("en-US")} characters.`);

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}
type Db = Awaited<ReturnType<typeof requireDb>>;

function limit(bucket: keyof typeof LIMITS, userId: number) {
  if (!checkTrpcRateLimit(`note-${bucket}:${userId}`, TEN_MINUTES, LIMITS[bucket])) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of note changes in a short time. Give it a few minutes." });
  }
}

/** The list shape: a short preview instead of the whole body. */
export function summarizeNote(row: Pick<NotePage, "id" | "title" | "courseId" | "createdAt" | "updatedAt"> & { preview: string }) {
  const preview = row.preview.replace(/[#*_`>\-\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  return { id: row.id, title: row.title, preview, courseId: row.courseId, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function publicNote(row: NotePage) {
  return { id: row.id, title: row.title, body: row.body, courseId: row.courseId, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** `explain`: for writes, where a missing table should say so instead of reading as "not found". */
async function loadOwned(db: Db, userId: number, id: number, explain = false): Promise<NotePage> {
  const find = () => db.select().from(notePages).where(and(eq(notePages.id, id), eq(notePages.userId, userId))).limit(1);
  const [row] = explain
    ? await explainMissingSchema(FEATURE_NAME, find)
    : await tolerateMissingSchema(FEATURE, find, [] as NotePage[]);
  // The query already filters by owner; checking again means a mistake there can never expose someone else's note.
  if (!row || row.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
  return row;
}

/** A null id clears the course; otherwise it must be the person's own, active course. */
async function checkCourse(userId: number, courseId: number | null | undefined) {
  if (courseId === null || courseId === undefined) return;
  const course = await getOwnCourse(courseId, userId);
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  if (course.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "That course is archived. Restore it before filing notes there." });
}

function noteConflict() {
  return new TRPCError({ code: "CONFLICT", message: "This note was changed somewhere else since you opened it. Your text has not been saved." });
}

/** The save time to store: whole seconds (the column's precision) and later than `previous`. */
export function nextStamp(previous: Date, now = Date.now()): Date {
  return new Date(Math.max(Math.floor(now / 1000) * 1000, previous.getTime() + 1000));
}

export const notePagesRouter = router({
  list: protectedProcedure
    .input(z.object({ courseId: z.number().int().positive().optional(), search: z.string().max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const term = input?.search?.trim();
      const rows = await tolerateMissingSchema(
        FEATURE,
        () =>
          db
            .select({ id: notePages.id, title: notePages.title, preview: sql<string>`SUBSTRING(${notePages.body}, 1, 400)`, courseId: notePages.courseId, createdAt: notePages.createdAt, updatedAt: notePages.updatedAt, userId: notePages.userId })
            .from(notePages)
            .where(and(
              eq(notePages.userId, ctx.user.id),
              input?.courseId ? eq(notePages.courseId, input.courseId) : undefined,
              term ? or(like(notePages.title, `%${escapeLike(term)}%`), like(notePages.body, `%${escapeLike(term)}%`)) : undefined,
            ))
            .orderBy(desc(notePages.updatedAt), desc(notePages.id))
            .limit(MAX_NOTE_PAGES_PER_USER),
        null,
      );
      return { available: rows !== null, notes: (rows ?? []).filter(row => row.userId === ctx.user.id).map(summarizeNote) };
    }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => publicNote(await loadOwned(await requireDb(), ctx.user.id, input.id))),

  create: protectedProcedure
    .input(z.object({ title: titleInput.optional(), body: bodyInput.optional(), courseId: z.number().int().positive().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      limit("create", ctx.user.id);
      const db = await requireDb();
      await checkCourse(ctx.user.id, input.courseId);
      return explainMissingSchema(FEATURE_NAME, async () => {
        const [totals] = await db.select({ count: sql<string>`COUNT(*)` }).from(notePages).where(eq(notePages.userId, ctx.user.id));
        if (Number(totals?.count ?? 0) >= MAX_NOTE_PAGES_PER_USER) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `You can keep up to ${MAX_NOTE_PAGES_PER_USER} notes. Delete some you no longer need.` });
        }
        const [result] = await db.insert(notePages).values({
          userId: ctx.user.id,
          title: input.title ?? "",
          body: input.body ?? "",
          courseId: input.courseId ?? null,
        });
        const newId = Number((result as any).insertId);
        // Parallel creates can all pass the check above, so count again after inserting and take this one back if over.
        const [after] = await db.select({ count: sql<string>`COUNT(*)` }).from(notePages).where(eq(notePages.userId, ctx.user.id));
        if (Number(after?.count ?? 0) > MAX_NOTE_PAGES_PER_USER) {
          await db.delete(notePages).where(and(eq(notePages.id, newId), eq(notePages.userId, ctx.user.id)));
          throw new TRPCError({ code: "BAD_REQUEST", message: `You can keep up to ${MAX_NOTE_PAGES_PER_USER} notes. Delete some you no longer need.` });
        }
        return { id: newId };
      });
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), title: titleInput.optional(), body: bodyInput.optional(), courseId: z.number().int().positive().nullable().optional(), expectedUpdatedAt: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      limit("write", ctx.user.id);
      const db = await requireDb();
      const note = await loadOwned(db, ctx.user.id, input.id, true);
      if (input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== note.updatedAt.getTime()) throw noteConflict();
      // Only a changed course is validated, so a note can still be saved after its course is archived.
      if (input.courseId !== undefined && input.courseId !== note.courseId) await checkCourse(ctx.user.id, input.courseId);
      const changes: Partial<typeof notePages.$inferInsert> = {};
      if (input.title !== undefined) changes.title = input.title;
      if (input.body !== undefined) changes.body = input.body;
      if (input.courseId !== undefined) changes.courseId = input.courseId;
      if (Object.keys(changes).length === 0) return { id: note.id, savedAt: note.updatedAt };
      // Whole seconds, and always later than the version this edit was based on, so the next compare can tell them apart.
      const savedAt = nextStamp(note.updatedAt);
      changes.updatedAt = savedAt;
      // Compare-and-set: the row changes only if nobody saved since we read it.
      const [outcome] = await explainMissingSchema(FEATURE_NAME, () =>
        db.update(notePages).set(changes).where(and(eq(notePages.id, note.id), eq(notePages.userId, ctx.user.id), eq(notePages.updatedAt, note.updatedAt))),
      );
      if (Number((outcome as any)?.affectedRows ?? 1) === 0) throw noteConflict();
      return { id: note.id, savedAt };
    }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    limit("write", ctx.user.id);
    const db = await requireDb();
    const note = await loadOwned(db, ctx.user.id, input.id, true);
    await explainMissingSchema(FEATURE_NAME, () => db.delete(notePages).where(and(eq(notePages.id, note.id), eq(notePages.userId, ctx.user.id))));
    return { id: note.id };
  }),

  /** Returns Markdown for the client to preview; nothing is saved here. */
  organize: aiProcedure
    .input(z.object({ id: z.number().int().positive(), mode: z.enum(NOTE_ORGANIZE_MODES) }))
    .mutation(async ({ ctx, input }) => {
      const note = await loadOwned(await requireDb(), ctx.user.id, input.id, true);
      if (note.body.trim().length < 20) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Write a little more in this note first." });
      }
      const { messages, shortened } = buildOrganizeMessages(input.mode, note.title, note.body);
      const text = await completeText({ messages, maxTokens: ORGANIZE_MAX_TOKENS[input.mode], timeoutMs: ORGANIZE_TIMEOUT_MS, what: "notes" });
      return { mode: input.mode, markdown: cleanOrganizedMarkdown(text), shortened };
    }),
});

/** For a course that goes away: its notes stay, just unfiled. */
export async function detachNotesFromCourse(userId: number, courseId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema(FEATURE, () => db.update(notePages).set({ courseId: null }).where(and(eq(notePages.userId, userId), eq(notePages.courseId, courseId))), undefined);
}

export async function deleteNotePagesForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema(FEATURE, () => db.delete(notePages).where(eq(notePages.userId, userId)), undefined);
}

export async function exportNotePagesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return tolerateMissingSchema(
    FEATURE,
    async () => (await db.select().from(notePages).where(eq(notePages.userId, userId))).map(({ userId: _owner, ...row }) => row),
    [] as Array<Omit<NotePage, "userId">>,
  );
}
