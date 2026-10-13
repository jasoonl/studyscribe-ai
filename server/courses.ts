import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { courses, recordingCourses, recordingTags, recordings, tags } from "../drizzle/schema";
import { isMissingTableError } from "./bookmarks";
import { getDb, getRecordingById } from "./db";
import { protectedProcedure, router } from "./_core/trpc";
import {
  MAX_COURSES_PER_USER,
  courseInputSchema,
  courseUpdateSchema,
  hasDuplicateName,
} from "./organizationInput";

/**
 * The courses tables arrive with migration 0019, which has to be applied by
 * hand (`npm run db:migrate`). Until it is, course reads return nothing and
 * writes explain themselves, so recordings keep loading, recording and
 * deleting keep working, and the rest of the app does not notice.
 */
async function tolerateMissingTable<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[courses] courses tables missing; run `npm run db:migrate` to enable courses");
      return fallback;
    }
    throw error;
  }
}

const NOT_SET_UP = "Courses are not set up on this server yet.";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export async function listCoursesForUser(userId: number, options: { includeArchived?: boolean } = {}) {
  const db = await requireDb();
  return tolerateMissingTable(async () => {
    const rows = await db
      .select({
        id: courses.id,
        name: courses.name,
        color: courses.color,
        term: courses.term,
        archived: courses.archived,
        createdAt: courses.createdAt,
      })
      .from(courses)
      .where(options.includeArchived ? eq(courses.userId, userId) : and(eq(courses.userId, userId), eq(courses.archived, false)))
      .orderBy(asc(courses.name));
    if (rows.length === 0) return [];
    // Counts only recordings that are not in the trash.
    const countRows = await db
      .select({ courseId: recordingCourses.courseId, total: sql<number>`count(*)` })
      .from(recordingCourses)
      .innerJoin(recordings, and(eq(recordings.id, recordingCourses.recordingId), eq(recordings.isDeleted, 0)))
      .where(eq(recordingCourses.userId, userId))
      .groupBy(recordingCourses.courseId);
    const byCourse = new Map(countRows.map(row => [row.courseId, Number(row.total)]));
    return rows.map(row => ({ ...row, recordingCount: byCourse.get(row.id) ?? 0 }));
  }, [] as Array<{ id: number; name: string; color: string; term: string | null; archived: boolean; createdAt: Date; recordingCount: number }>);
}

/** recordingId -> courseId for the given recordings (or every one the person has). */
export async function getCourseAssignments(userId: number, recordingIds?: number[]): Promise<Map<number, number>> {
  const db = await requireDb();
  return tolerateMissingTable(async () => {
    const where =
      recordingIds && recordingIds.length > 0
        ? and(eq(recordingCourses.userId, userId), inArray(recordingCourses.recordingId, recordingIds))
        : eq(recordingCourses.userId, userId);
    const rows = await db.select().from(recordingCourses).where(where);
    return new Map(rows.map(row => [row.recordingId, row.courseId]));
  }, new Map<number, number>());
}

export async function getTagAssignments(recordingIds: number[]): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (recordingIds.length === 0) return result;
  const db = await requireDb();
  for (let i = 0; i < recordingIds.length; i += 500) {
    const rows = await db.select().from(recordingTags).where(inArray(recordingTags.recordingId, recordingIds.slice(i, i + 500)));
    for (const row of rows) {
      const list = result.get(row.recordingId) ?? [];
      list.push(row.tagId);
      result.set(row.recordingId, list);
    }
  }
  return result;
}

/**
 * Adds `courseId` and `tagIds` to each recording row so the library can filter
 * and label without a request per card. A tag that was deleted but left a
 * stray junction row is filtered out by checking against the person's tags.
 */
export async function attachOrganization<T extends { id: number }>(userId: number, rows: T[]) {
  const ids = rows.map(row => row.id);
  const [assignments, tagMap, ownTags] = await Promise.all([
    getCourseAssignments(userId, ids),
    getTagAssignments(ids),
    (await requireDb()).select({ id: tags.id }).from(tags).where(eq(tags.userId, userId)),
  ]);
  const ownTagIds = new Set(ownTags.map(tag => tag.id));
  return rows.map(row => ({
    ...row,
    courseId: assignments.get(row.id) ?? null,
    tagIds: (tagMap.get(row.id) ?? []).filter(id => ownTagIds.has(id)),
  }));
}

export async function deleteCourseLinksForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await requireDb();
  await tolerateMissingTable(() => db.delete(recordingCourses).where(inArray(recordingCourses.recordingId, recordingIds)), undefined);
}

export async function deleteCoursesForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingTable(async () => {
    await db.delete(recordingCourses).where(eq(recordingCourses.userId, userId));
    await db.delete(courses).where(eq(courses.userId, userId));
  }, undefined);
}

export async function exportCoursesForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingTable(
    async () => ({
      courses: await db.select().from(courses).where(eq(courses.userId, userId)),
      courseAssignments: await db
        .select({ recordingId: recordingCourses.recordingId, courseId: recordingCourses.courseId })
        .from(recordingCourses)
        .where(eq(recordingCourses.userId, userId)),
    }),
    { courses: [], courseAssignments: [] },
  );
}

export async function recordingIdsInCourse(userId: number, courseId: number): Promise<number[]> {
  const db = await requireDb();
  return tolerateMissingTable(async () => {
    const rows = await db
      .select({ recordingId: recordingCourses.recordingId })
      .from(recordingCourses)
      .where(and(eq(recordingCourses.userId, userId), eq(recordingCourses.courseId, courseId)));
    return rows.map(row => row.recordingId);
  }, [] as number[]);
}

export async function getOwnCourse(courseId: number, userId: number) {
  const db = await requireDb();
  const [course] = await tolerateMissingTable(
    () => db.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.userId, userId))).limit(1),
    [] as Array<typeof courses.$inferSelect>,
  );
  return course ?? null;
}

export async function assignRecordingToCourse(userId: number, recordingId: number, courseId: number | null) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });

  const db = await requireDb();
  if (courseId === null) {
    await tolerateMissingTable(() => db.delete(recordingCourses).where(eq(recordingCourses.recordingId, recordingId)), undefined);
    return { courseId: null };
  }

  const course = await getOwnCourse(courseId, userId);
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  if (course.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "That course is archived. Restore it before adding recordings." });

  try {
    await db
      .insert(recordingCourses)
      .values({ recordingId, courseId, userId })
      .onDuplicateKeyUpdate({ set: { courseId, userId } });
  } catch (error) {
    if (isMissingTableError(error)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_SET_UP });
    throw error;
  }
  return { courseId };
}

export const coursesRouter = router({
  list: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => listCoursesForUser(ctx.user.id, { includeArchived: input?.includeArchived })),

  get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const course = await getOwnCourse(input.id, ctx.user.id);
    if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
    return { id: course.id, name: course.name, color: course.color, term: course.term, archived: course.archived };
  }),

  create: protectedProcedure.input(courseInputSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    try {
      const existing = await db.select({ id: courses.id, name: courses.name }).from(courses).where(eq(courses.userId, ctx.user.id));
      if (existing.length >= MAX_COURSES_PER_USER) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `You can have up to ${MAX_COURSES_PER_USER} courses. Archive one you no longer use.` });
      }
      if (hasDuplicateName(existing, input.name)) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a course with that name." });
      }
      const [result] = await db.insert(courses).values({
        userId: ctx.user.id,
        name: input.name,
        color: input.color ?? "blue",
        term: input.term ?? null,
      });
      return { id: Number((result as any).insertId) };
    } catch (error) {
      if (isMissingTableError(error)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_SET_UP });
      throw error;
    }
  }),

  update: protectedProcedure.input(courseUpdateSchema).mutation(async ({ ctx, input }) => {
    const course = await getOwnCourse(input.id, ctx.user.id);
    if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
    const db = await requireDb();
    if (input.name !== undefined) {
      const existing = await db.select({ id: courses.id, name: courses.name }).from(courses).where(eq(courses.userId, ctx.user.id));
      if (hasDuplicateName(existing, input.name, course.id)) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a course with that name." });
      }
    }
    const changes: Partial<typeof courses.$inferInsert> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.color !== undefined) changes.color = input.color;
    if (input.term !== undefined) changes.term = input.term === "" ? null : input.term;
    if (Object.keys(changes).length > 0) {
      await db.update(courses).set(changes).where(and(eq(courses.id, course.id), eq(courses.userId, ctx.user.id)));
    }
    return { id: course.id };
  }),

  /** Archived courses drop out of pickers and the library strip; their recordings stay assigned. */
  archive: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), archived: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const course = await getOwnCourse(input.id, ctx.user.id);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      const db = await requireDb();
      await db.update(courses).set({ archived: input.archived }).where(and(eq(courses.id, course.id), eq(courses.userId, ctx.user.id)));
      return { id: course.id, archived: input.archived };
    }),
});
