import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  courses,
  flashcardReviews,
  flashcards,
  flashcardSchedules,
  quizAttempts,
  quizzes,
  recordingCourses,
  recordings,
  studyEvents,
} from "../drizzle/schema";
import {
  addDays,
  buildDailyPlan,
  cardMastery,
  clampReviewSeconds,
  computeStreak,
  dailyActivity,
  isIsoDate,
  nextSchedule,
  scheduleFromLegacyStatus,
  type CardSchedule,
  type Grade,
  type PlanExam,
} from "../shared/studyPlanner";
import { isMissingTableError } from "./bookmarks";
import { getDb } from "./db";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * The study planner and progress page (Phase 7). flashcardSchedules and
 * studyEvents arrive with migration 0031, applied by hand; until then reviews
 * are saved exactly as before, the plan falls back to the old review statuses,
 * and progress shows what quizAttempts alone can tell.
 */

async function tolerate<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(`[planner] ${label}: table missing; run \`npm run db:migrate\` (migration 0031)`);
      return fallback;
    }
    throw error;
  }
}

/** The browser sends its own calendar date; anything else falls back to UTC's. */
export function resolveLocalDate(value: unknown): string {
  return isIsoDate(value) ? value : new Date().toISOString().slice(0, 10);
}

const localDateSchema = z.string().refine(isIsoDate, "Expected a date as YYYY-MM-DD");

function toSchedule(row: typeof flashcardSchedules.$inferSelect): CardSchedule {
  return { intervalDays: row.intervalDays, ease: row.easeX100 / 100, reps: row.reps, lapses: row.lapses, dueDate: row.dueDate };
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function courseByRecording(db: Db, userId: number): Promise<Map<number, number>> {
  const rows = await tolerate(
    "recordingCourses",
    () => db.select({ recordingId: recordingCourses.recordingId, courseId: recordingCourses.courseId }).from(recordingCourses).where(eq(recordingCourses.userId, userId)),
    [] as Array<{ recordingId: number; courseId: number }>,
  );
  return new Map(rows.map((r) => [r.recordingId, r.courseId]));
}

async function upcomingExams(db: Db, userId: number, today: string, courseOf: Map<number, number>): Promise<PlanExam[]> {
  const rows = await tolerate(
    "actionItems",
    () =>
      db
        .select({ text: actionItems.text, dueDate: actionItems.dueDate, recordingId: actionItems.recordingId })
        .from(actionItems)
        .where(and(eq(actionItems.userId, userId), eq(actionItems.kind, "exam"), eq(actionItems.done, false), gte(actionItems.dueDate, today))),
    [] as Array<{ text: string; dueDate: string | null; recordingId: number }>,
  );
  return rows
    .filter((r): r is typeof r & { dueDate: string } => Boolean(r.dueDate))
    .map((r) => ({ text: r.text, date: r.dueDate, recordingId: r.recordingId, courseId: courseOf.get(r.recordingId) ?? null }));
}

/** Every card the person owns in a live recording, with its schedule (or one derived from the old status). */
async function loadCards(db: Db, userId: number, today: string) {
  const live = await db
    .select({ id: recordings.id, title: recordings.title })
    .from(recordings)
    .where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0)));
  const liveIds = new Set(live.map((r) => r.id));
  const cardRows = (await db.select({ id: flashcards.id, recordingId: flashcards.recordingId }).from(flashcards).where(eq(flashcards.userId, userId))).filter((c) =>
    liveIds.has(c.recordingId),
  );
  const scheduleRows = await tolerate(
    "flashcardSchedules",
    () => db.select().from(flashcardSchedules).where(eq(flashcardSchedules.userId, userId)),
    [] as Array<typeof flashcardSchedules.$inferSelect>,
  );
  const schedules = new Map(scheduleRows.map((row) => [row.flashcardId, toSchedule(row)]));
  const legacy = new Map(
    (
      await db
        .select({ flashcardId: flashcardReviews.flashcardId, status: flashcardReviews.status, lastReviewedAt: flashcardReviews.lastReviewedAt })
        .from(flashcardReviews)
        .where(eq(flashcardReviews.userId, userId))
    ).map((r) => [r.flashcardId, r]),
  );
  const cards = cardRows.map((card) => {
    let schedule = schedules.get(card.id) ?? null;
    if (!schedule) {
      const old = legacy.get(card.id);
      if (old) schedule = scheduleFromLegacyStatus(old.status, old.lastReviewedAt ? old.lastReviewedAt.toISOString().slice(0, 10) : null, today);
    }
    return { flashcardId: card.id, recordingId: card.recordingId, schedule };
  });
  return { live, cards, lapses: scheduleRows };
}

export async function getDailyPlan(userId: number, today: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const courseOf = await courseByRecording(db, userId);
  const { live, cards } = await loadCards(db, userId, today);
  const exams = await upcomingExams(db, userId, today, courseOf);
  const plan = buildDailyPlan({
    today,
    cards,
    exams,
    recordings: live.map((r) => ({ id: r.id, title: r.title, courseId: courseOf.get(r.id) ?? null })),
  });
  return { ...plan, totalCards: cards.length };
}

/** Questions and answers for a review session, in the order given, limited to the person's own cards. */
export async function getCardsForSession(userId: number, ids: number[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ id: flashcards.id, recordingId: flashcards.recordingId, question: flashcards.question, answer: flashcards.answer, difficulty: flashcards.difficulty })
    .from(flashcards)
    .where(and(eq(flashcards.userId, userId), inArray(flashcards.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => Boolean(r));
}

/**
 * Called after a card is reviewed (on any page): moves its schedule on and logs
 * the review. Never throws for a missing table, so reviewing works before 0031.
 */
export async function recordCardStudy(input: { userId: number; recordingId: number; flashcardId: number; grade: Grade; seconds?: number; localDate?: string }) {
  const db = await getDb();
  if (!db) return;
  const today = resolveLocalDate(input.localDate);
  // The review itself is already saved; a planner problem must not turn it into an error.
  await tolerate(
    "recordCardStudy",
    async () => {
      const [existing] = await db
        .select()
        .from(flashcardSchedules)
        .where(and(eq(flashcardSchedules.userId, input.userId), eq(flashcardSchedules.flashcardId, input.flashcardId)))
        .limit(1);
      const courseOf = await courseByRecording(db, input.userId);
      const exams = await upcomingExams(db, input.userId, today, courseOf);
      const courseId = courseOf.get(input.recordingId) ?? null;
      const exam = exams
        .filter((e) => e.recordingId === input.recordingId || (courseId !== null && e.courseId === courseId))
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      let previous = existing ? toSchedule(existing) : null;
      if (!previous) {
        // First review since scheduling began: carry on from the old status rather than starting over.
        const [old] = await db
          .select({ status: flashcardReviews.status, lastReviewedAt: flashcardReviews.lastReviewedAt })
          .from(flashcardReviews)
          .where(and(eq(flashcardReviews.userId, input.userId), eq(flashcardReviews.flashcardId, input.flashcardId)))
          .limit(1);
        if (old) previous = scheduleFromLegacyStatus(old.status, old.lastReviewedAt ? old.lastReviewedAt.toISOString().slice(0, 10) : null, today);
      }
      const next = nextSchedule(previous, input.grade, today, exam?.date ?? null);
      const values = {
        dueDate: next.dueDate,
        intervalDays: next.intervalDays,
        easeX100: Math.round(next.ease * 100),
        reps: next.reps,
        lapses: next.lapses,
      };
      if (existing) {
        await db.update(flashcardSchedules).set(values).where(eq(flashcardSchedules.id, existing.id));
      } else {
        await db.insert(flashcardSchedules).values({ userId: input.userId, flashcardId: input.flashcardId, recordingId: input.recordingId, ...values });
      }
      await db.insert(studyEvents).values({
        userId: input.userId,
        kind: "flashcard",
        recordingId: input.recordingId,
        flashcardId: input.flashcardId,
        result: input.grade === "good" ? 1 : 0,
        seconds: clampReviewSeconds(input.seconds),
        localDate: today,
      });
    },
    undefined,
  ).catch((error) => console.error("[planner] could not schedule the review:", error));
}

export async function recordQuizStudy(input: { userId: number; recordingId: number; quizId: number; score: number; localDate?: string }) {
  const db = await getDb();
  if (!db) return;
  await tolerate(
    "recordQuizStudy",
    () =>
      db.insert(studyEvents).values({
        userId: input.userId,
        kind: "quiz",
        recordingId: input.recordingId,
        quizId: input.quizId,
        result: Math.max(0, Math.min(100, Math.round(input.score))),
        localDate: resolveLocalDate(input.localDate),
      }),
    undefined,
  ).catch((error) => console.error("[planner] could not log the quiz:", error));
}

export async function getProgress(userId: number, today: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const courseOf = await courseByRecording(db, userId);
  const { live, cards, lapses } = await loadCards(db, userId, today);
  const titles = new Map(live.map((r) => [r.id, r.title]));

  const since = addDays(today, -400);
  const events = await tolerate(
    "studyEvents",
    () =>
      db
        .select({ kind: studyEvents.kind, localDate: studyEvents.localDate, seconds: studyEvents.seconds, result: studyEvents.result })
        .from(studyEvents)
        .where(and(eq(studyEvents.userId, userId), gte(studyEvents.localDate, since))),
    [] as Array<{ kind: "flashcard" | "quiz"; localDate: string; seconds: number; result: number }>,
  );
  const tracking = await tolerate(
    "studyEvents probe",
    async () => {
      await db.select({ n: sql<number>`1` }).from(studyEvents).limit(1);
      return true;
    },
    false,
  );

  const streak = computeStreak(
    events.map((e) => e.localDate),
    today,
  );
  const activity = dailyActivity(events, today, 28);
  const weekStart = addDays(today, -6);
  const week = events.filter((e) => e.localDate >= weekStart);
  const cardEvents = week.filter((e) => e.kind === "flashcard");

  // Mastery by course: cards grouped by their recording's course.
  const courseRows = await tolerate(
    "courses",
    () => db.select({ id: courses.id, name: courses.name, color: courses.color, archived: courses.archived }).from(courses).where(eq(courses.userId, userId)),
    [] as Array<{ id: number; name: string; color: string; archived: boolean }>,
  );
  const groups = new Map<number | null, typeof cards>();
  for (const card of cards) {
    const key = courseOf.get(card.recordingId) ?? null;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const mastery = Array.from(groups.entries())
    .map(([courseId, group]) => {
      const course = courseRows.find((c) => c.id === courseId);
      return { courseId, name: course?.name ?? "Not in a course", color: course?.color ?? null, ...cardMastery(group) };
    })
    .sort((a, b) => (a.courseId === null ? 1 : b.courseId === null ? -1 : a.name.localeCompare(b.name)));

  // Weak spots: cards forgotten more than once, and recordings whose quizzes go badly.
  const hard = lapses.filter((s) => s.lapses >= 2 && titles.has(s.recordingId)).sort((a, b) => b.lapses - a.lapses).slice(0, 5);
  const hardCards = hard.length
    ? await db.select({ id: flashcards.id, question: flashcards.question }).from(flashcards).where(and(eq(flashcards.userId, userId), inArray(flashcards.id, hard.map((h) => h.flashcardId))))
    : [];
  const quizRows = await db
    .select({ recordingId: quizzes.recordingId, score: quizAttempts.score })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .where(eq(quizAttempts.userId, userId))
    .orderBy(desc(quizAttempts.createdAt))
    .limit(500);
  const quizBy = new Map<number, number[]>();
  for (const row of quizRows) {
    if (row.score === null || !titles.has(row.recordingId)) continue;
    quizBy.set(row.recordingId, [...(quizBy.get(row.recordingId) ?? []), row.score]);
  }
  const weakQuizzes = Array.from(quizBy.entries())
    .map(([recordingId, scores]) => ({ recordingId, title: titles.get(recordingId)!, average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), attempts: scores.length }))
    .filter((q) => q.average < 70)
    .sort((a, b) => a.average - b.average)
    .slice(0, 5);

  return {
    today,
    tracking,
    streak,
    activity,
    week: {
      minutes: Math.round(week.reduce((sum, e) => sum + e.seconds, 0) / 60),
      cardsReviewed: cardEvents.length,
      remembered: cardEvents.filter((e) => e.result === 1).length,
      quizzes: week.filter((e) => e.kind === "quiz").length,
    },
    mastery,
    weakCards: hard
      .map((h) => ({ flashcardId: h.flashcardId, recordingId: h.recordingId, lapses: h.lapses, question: hardCards.find((c) => c.id === h.flashcardId)?.question ?? "", title: titles.get(h.recordingId)! }))
      .filter((c) => c.question),
    weakQuizzes,
  };
}

export const plannerRouter = router({
  today: protectedProcedure.input(z.object({ today: localDateSchema })).query(({ ctx, input }) => getDailyPlan(ctx.user.id, input.today)),
  sessionCards: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).max(300) }))
    .query(({ ctx, input }) => getCardsForSession(ctx.user.id, input.ids)),
  progress: protectedProcedure.input(z.object({ today: localDateSchema })).query(({ ctx, input }) => getProgress(ctx.user.id, input.today)),
});

// ─── Purge, export and account deletion ─────────────────────────────────────

export async function deletePlannerDataForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  await tolerate("purge schedules", () => db.delete(flashcardSchedules).where(inArray(flashcardSchedules.recordingId, recordingIds)), undefined);
  await tolerate("purge study events", () => db.delete(studyEvents).where(inArray(studyEvents.recordingId, recordingIds)), undefined);
}

export async function exportPlannerDataForUser(userId: number) {
  const db = await getDb();
  if (!db) return { flashcardSchedules: [], studyActivity: [] };
  return {
    flashcardSchedules: await tolerate("export schedules", () => db.select().from(flashcardSchedules).where(eq(flashcardSchedules.userId, userId)), []),
    studyActivity: await tolerate("export study events", () => db.select().from(studyEvents).where(eq(studyEvents.userId, userId)), []),
  };
}

export async function deletePlannerDataForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerate("delete schedules", () => db.delete(flashcardSchedules).where(eq(flashcardSchedules.userId, userId)), undefined);
  await tolerate("delete study events", () => db.delete(studyEvents).where(eq(studyEvents.userId, userId)), undefined);
}
