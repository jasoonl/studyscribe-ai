// Spaced repetition, the daily study plan and progress figures (Phase 7).
// Pure functions only: the server feeds them rows, the tests feed them fixtures.
// Dates are the learner's own calendar days as "YYYY-MM-DD"; the browser sends
// its local date, so "today" and streaks follow the person's time zone.

export type Grade = "again" | "good";

export type CardSchedule = {
  intervalDays: number;
  /** Growth factor for the next interval, between MIN_EASE and MAX_EASE. */
  ease: number;
  /** Successful reviews in a row. */
  reps: number;
  /** Times the card was forgotten after being learned. */
  lapses: number;
  dueDate: string;
};

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 2.8;
export const MAX_INTERVAL_DAYS = 180;
/** New cards introduced per day across all recordings, so a big deck doesn't arrive at once. */
export const NEW_CARDS_PER_DAY = 20;
/** Exams further away than this don't change the order of the plan. */
export const EXAM_HORIZON_DAYS = 21;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * A light SM-2. "again" brings the card back tomorrow and makes it grow more
 * slowly; "good" grows the gap 1 day, 3 days, then by its ease. Before an exam
 * the gap is capped at half the days left, so every card is seen again in time.
 */
export function nextSchedule(prev: CardSchedule | null, grade: Grade, today: string, examDate?: string | null): CardSchedule {
  const base = prev ?? { intervalDays: 0, ease: START_EASE, reps: 0, lapses: 0, dueDate: today };
  let { ease, reps, lapses } = base;
  let interval: number;
  if (grade === "again") {
    ease = Math.max(MIN_EASE, ease - 0.2);
    if (reps > 0) lapses += 1;
    reps = 0;
    interval = 1;
  } else {
    ease = Math.min(MAX_EASE, ease + 0.05);
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(Math.max(base.intervalDays, 1) * ease);
  }
  if (examDate) {
    const left = daysBetween(today, examDate);
    if (left > 1) interval = Math.min(interval, Math.max(1, Math.floor(left / 2)));
  }
  interval = Math.max(1, Math.min(MAX_INTERVAL_DAYS, interval));
  return { intervalDays: interval, ease: Math.round(ease * 100) / 100, reps, lapses, dueDate: addDays(today, interval) };
}

/**
 * Cards reviewed before scheduling existed have only a status. Learning cards
 * are due now; mastered ones are treated as seen twice and due a week after
 * their last review.
 */
export function scheduleFromLegacyStatus(
  status: "new" | "learning" | "mastered",
  lastReviewed: string | null,
  today: string,
): CardSchedule | null {
  if (status === "new") return null;
  if (status === "learning") return { intervalDays: 1, ease: START_EASE, reps: 0, lapses: 0, dueDate: today };
  const from = lastReviewed && isIsoDate(lastReviewed) ? lastReviewed : today;
  return { intervalDays: 7, ease: START_EASE, reps: 2, lapses: 0, dueDate: addDays(from, 7) };
}

// ─── The daily plan ─────────────────────────────────────────────────────────

export type PlanCard = { flashcardId: number; recordingId: number; schedule: CardSchedule | null };
export type PlanRecording = { id: number; title: string; courseId: number | null };
export type PlanExam = { text: string; date: string; recordingId: number; courseId: number | null };

export type PlanItem = {
  recordingId: number;
  title: string;
  courseId: number | null;
  /** Cards already learned that are due today or overdue. */
  due: number;
  /** New cards to introduce today. */
  fresh: number;
  /** Days to the nearest exam this recording counts towards, if within the horizon. */
  examInDays: number | null;
  examText: string | null;
};

export type DailyPlan = {
  today: string;
  items: PlanItem[];
  totalDue: number;
  totalFresh: number;
  /** Card ids in the order to review them: exam-nearest recordings first, due before new. */
  queue: number[];
  exams: Array<PlanExam & { inDays: number }>;
};

/** The nearest exam on or after today for a recording: its own, or one for its course. */
function examFor(recording: PlanRecording, exams: Array<PlanExam & { inDays: number }>) {
  let best: (PlanExam & { inDays: number }) | null = null;
  for (const exam of exams) {
    const applies = exam.recordingId === recording.id || (exam.courseId !== null && exam.courseId === recording.courseId);
    if (applies && (!best || exam.inDays < best.inDays)) best = exam;
  }
  return best;
}

export function buildDailyPlan(input: {
  today: string;
  cards: PlanCard[];
  recordings: PlanRecording[];
  exams: PlanExam[];
  newPerDay?: number;
}): DailyPlan {
  const { today } = input;
  const exams = input.exams
    .filter((e) => isIsoDate(e.date) && daysBetween(today, e.date) >= 0)
    .map((e) => ({ ...e, inDays: daysBetween(today, e.date) }))
    .sort((a, b) => a.inDays - b.inDays);
  const byRecording = new Map(input.recordings.map((r) => [r.id, r]));

  const groups = new Map<number, { due: PlanCard[]; fresh: PlanCard[] }>();
  for (const card of input.cards) {
    if (!byRecording.has(card.recordingId)) continue;
    const group = groups.get(card.recordingId) ?? { due: [], fresh: [] };
    if (!card.schedule) group.fresh.push(card);
    else if (card.schedule.dueDate <= today) group.due.push(card);
    groups.set(card.recordingId, group);
  }

  const ranked = [...groups.entries()]
    .map(([recordingId, group]) => {
      const recording = byRecording.get(recordingId)!;
      const exam = examFor(recording, exams);
      const examInDays = exam && exam.inDays <= EXAM_HORIZON_DAYS ? exam.inDays : null;
      // Overdue cards first within a recording.
      group.due.sort((a, b) => a.schedule!.dueDate.localeCompare(b.schedule!.dueDate) || a.flashcardId - b.flashcardId);
      group.fresh.sort((a, b) => a.flashcardId - b.flashcardId);
      return { recording, group, examInDays, examText: examInDays !== null ? exam!.text : null };
    })
    .sort(
      (a, b) =>
        (a.examInDays ?? Infinity) - (b.examInDays ?? Infinity) ||
        b.group.due.length - a.group.due.length ||
        a.recording.id - b.recording.id,
    );

  let freshLeft = input.newPerDay ?? NEW_CARDS_PER_DAY;
  const items: PlanItem[] = [];
  const dueQueue: number[] = [];
  const freshQueue: number[] = [];
  for (const { recording, group, examInDays, examText } of ranked) {
    const fresh = group.fresh.slice(0, Math.max(0, freshLeft));
    freshLeft -= fresh.length;
    if (group.due.length === 0 && fresh.length === 0) continue;
    items.push({ recordingId: recording.id, title: recording.title, courseId: recording.courseId, due: group.due.length, fresh: fresh.length, examInDays, examText });
    dueQueue.push(...group.due.map((c) => c.flashcardId));
    freshQueue.push(...fresh.map((c) => c.flashcardId));
  }
  return {
    today,
    items,
    totalDue: dueQueue.length,
    totalFresh: freshQueue.length,
    queue: [...dueQueue, ...freshQueue],
    exams,
  };
}

// ─── Progress ───────────────────────────────────────────────────────────────

/** Consecutive days with any study, ending today (or yesterday, so a streak survives until the day ends). */
export function computeStreak(studyDays: string[], today: string): { current: number; longest: number } {
  const days = [...new Set(studyDays.filter(isIsoDate))].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous && daysBetween(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const set = new Set(days);
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

/** Study events per day for the last `days` days, oldest first, zero-filled. */
export function dailyActivity(events: Array<{ localDate: string; seconds: number }>, today: string, days = 28) {
  const counts = new Map<string, { reviews: number; seconds: number }>();
  for (const e of events) {
    const entry = counts.get(e.localDate) ?? { reviews: 0, seconds: 0 };
    entry.reviews += 1;
    entry.seconds += Math.max(0, e.seconds);
    counts.set(e.localDate, entry);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    return { date, ...(counts.get(date) ?? { reviews: 0, seconds: 0 }) };
  });
}

/** Share of a course's cards that are learned well enough to be spaced a week or more. */
export function cardMastery(cards: Array<{ schedule: CardSchedule | null }>): { total: number; mastered: number; learning: number; fresh: number } {
  let mastered = 0;
  let learning = 0;
  let fresh = 0;
  for (const card of cards) {
    if (!card.schedule) fresh += 1;
    else if (card.schedule.intervalDays >= 7) mastered += 1;
    else learning += 1;
  }
  return { total: cards.length, mastered, learning, fresh };
}

/** Seconds a single review may count for; a card left on screen during a break shouldn't add an hour. */
export const MAX_REVIEW_SECONDS = 120;

export function clampReviewSeconds(seconds: number | undefined | null): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(MAX_REVIEW_SECONDS, Math.round(seconds));
}
