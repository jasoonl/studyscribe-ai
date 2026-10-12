import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { recordingBookmarks } from "../drizzle/schema";
import { getDb, getRecordingById } from "./db";
import { protectedProcedure, router } from "./_core/trpc";

export const MAX_BOOKMARKS_PER_RECORDING = 200;

export const bookmarkInputSchema = z.object({
  atSeconds: z.number().finite().min(0).max(24 * 3600),
  label: z.string().trim().max(120).optional(),
});

/**
 * The recordingBookmarks table arrives with migration 0018, which has to be
 * applied by hand (`npm run db:migrate`). Until it is, bookmark reads return
 * nothing and writes are skipped, so recording and deleting keep working.
 */
export function isMissingTableError(error: unknown): boolean {
  for (let current: any = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current.code === "ER_NO_SUCH_TABLE" || current.errno === 1146) return true;
    if (typeof current.message === "string" && /recordingBookmarks.*doesn't exist/i.test(current.message)) return true;
  }
  return false;
}

async function tolerateMissingTable<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[bookmarks] recordingBookmarks table missing; run `npm run db:migrate` to enable bookmarks");
      return fallback;
    }
    throw error;
  }
}

export async function saveBookmarks(recordingId: number, userId: number, marks: Array<z.infer<typeof bookmarkInputSchema>>) {
  if (marks.length === 0) return false;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return tolerateMissingTable(async () => {
    await db.insert(recordingBookmarks).values(
      marks.slice(0, MAX_BOOKMARKS_PER_RECORDING).map(mark => ({
        recordingId,
        userId,
        atSeconds: Math.round(mark.atSeconds),
        label: mark.label || null,
      })),
    );
    return true;
  }, false);
}

export async function deleteBookmarksForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await tolerateMissingTable(() => db.delete(recordingBookmarks).where(inArray(recordingBookmarks.recordingId, recordingIds)), undefined);
}

export async function deleteBookmarksForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await tolerateMissingTable(() => db.delete(recordingBookmarks).where(eq(recordingBookmarks.userId, userId)), undefined);
}

export async function listBookmarksForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return tolerateMissingTable(() => db.select().from(recordingBookmarks).where(eq(recordingBookmarks.userId, userId)), []);
}

async function assertOwnRecording(recordingId: number, userId: number) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.userId !== userId) throw new Error("Recording not found");
  return recording;
}

export const bookmarksRouter = router({
  list: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await assertOwnRecording(input.recordingId, ctx.user.id);
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return tolerateMissingTable(
      () =>
        db
          .select()
          .from(recordingBookmarks)
          .where(and(eq(recordingBookmarks.recordingId, input.recordingId), eq(recordingBookmarks.userId, ctx.user.id)))
          .orderBy(asc(recordingBookmarks.atSeconds)),
      [],
    );
  }),

  add: protectedProcedure
    .input(bookmarkInputSchema.extend({ recordingId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await assertOwnRecording(input.recordingId, ctx.user.id);
      const saved = await saveBookmarks(input.recordingId, ctx.user.id, [{ atSeconds: input.atSeconds, label: input.label }]);
      if (!saved) throw new Error("Bookmarks are not set up on this server yet.");
      return { saved };
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await tolerateMissingTable(
      () => db.delete(recordingBookmarks).where(and(eq(recordingBookmarks.id, input.id), eq(recordingBookmarks.userId, ctx.user.id))),
      undefined,
    );
    return { removed: true };
  }),
});
