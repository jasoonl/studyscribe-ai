import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDailyPlan,
  cardMastery,
  clampReviewSeconds,
  computeStreak,
  dailyActivity,
  daysBetween,
  isIsoDate,
  MIN_EASE,
  nextSchedule,
  scheduleFromLegacyStatus,
  type CardSchedule,
} from "../shared/studyPlanner";

const today = "2026-10-14";

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("counts days between dates", () => {
    expect(daysBetween("2026-10-14", "2026-10-21")).toBe(7);
    expect(daysBetween("2026-10-21", "2026-10-14")).toBe(-7);
  });
  it("rejects malformed and impossible dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(isIsoDate("2026-10-14")).toBe(true);
  });
});

describe("nextSchedule", () => {
  it("grows the gap 1, 3, then by ease", () => {
    const first = nextSchedule(null, "good", today);
    expect(first.intervalDays).toBe(1);
    const second = nextSchedule(first, "good", first.dueDate);
    expect(second.intervalDays).toBe(3);
    const third = nextSchedule(second, "good", second.dueDate);
    expect(third.intervalDays).toBe(Math.round(3 * third.ease));
    expect(third.dueDate).toBe(addDays(second.dueDate, third.intervalDays));
  });

  it("brings a forgotten card back tomorrow and counts the lapse", () => {
    const learned: CardSchedule = { intervalDays: 20, ease: 2.5, reps: 4, lapses: 0, dueDate: today };
    const next = nextSchedule(learned, "again", today);
    expect(next).toMatchObject({ intervalDays: 1, reps: 0, lapses: 1, dueDate: addDays(today, 1) });
    expect(next.ease).toBeCloseTo(2.3);
  });

  it("does not count a lapse on a card never learned, and keeps ease above the floor", () => {
    let s: CardSchedule | null = null;
    for (let i = 0; i < 20; i++) s = nextSchedule(s, "again", today);
    expect(s!.lapses).toBe(0);
    expect(s!.ease).toBe(MIN_EASE);
  });

  it("caps the gap so the card comes back before an exam", () => {
    const learned: CardSchedule = { intervalDays: 30, ease: 2.5, reps: 5, lapses: 0, dueDate: today };
    const next = nextSchedule(learned, "good", today, addDays(today, 10));
    expect(next.intervalDays).toBe(5);
    expect(nextSchedule(learned, "good", today, addDays(today, 1)).intervalDays).toBeGreaterThan(5);
  });
});

describe("scheduleFromLegacyStatus", () => {
  it("maps old statuses", () => {
    expect(scheduleFromLegacyStatus("new", null, today)).toBeNull();
    expect(scheduleFromLegacyStatus("learning", "2026-10-01", today)?.dueDate).toBe(today);
    expect(scheduleFromLegacyStatus("mastered", "2026-10-01", today)?.dueDate).toBe("2026-10-08");
  });
});

describe("buildDailyPlan", () => {
  const recordings = [
    { id: 1, title: "Biology", courseId: 10 },
    { id: 2, title: "History", courseId: 20 },
    { id: 3, title: "Chemistry", courseId: null },
  ];
  const due = (dueDate: string): CardSchedule => ({ intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, dueDate });

  it("puts the recording with the nearest exam first, due cards before new ones", () => {
    const plan = buildDailyPlan({
      today,
      recordings,
      cards: [
        { flashcardId: 11, recordingId: 1, schedule: due(today) },
        { flashcardId: 21, recordingId: 2, schedule: due(addDays(today, -2)) },
        { flashcardId: 22, recordingId: 2, schedule: null },
        { flashcardId: 23, recordingId: 2, schedule: due(addDays(today, 5)) },
      ],
      exams: [{ text: "History midterm", date: addDays(today, 3), recordingId: 99, courseId: 20 }],
    });
    expect(plan.items.map((i) => i.recordingId)).toEqual([2, 1]);
    expect(plan.items[0]).toMatchObject({ due: 1, fresh: 1, examInDays: 3, examText: "History midterm" });
    expect(plan.queue).toEqual([21, 11, 22]);
    expect(plan.totalDue).toBe(2);
    expect(plan.totalFresh).toBe(1);
  });

  it("limits new cards per day and ignores past exams and unknown recordings", () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ flashcardId: 100 + i, recordingId: 3, schedule: null }));
    const plan = buildDailyPlan({
      today,
      recordings,
      cards: [...cards, { flashcardId: 999, recordingId: 42, schedule: null }],
      exams: [{ text: "Old exam", date: addDays(today, -1), recordingId: 3, courseId: null }],
      newPerDay: 5,
    });
    expect(plan.totalFresh).toBe(5);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].examInDays).toBeNull();
    expect(plan.exams).toHaveLength(0);
  });

  it("is empty when nothing is due", () => {
    const plan = buildDailyPlan({ today, recordings, cards: [{ flashcardId: 1, recordingId: 1, schedule: due(addDays(today, 1)) }], exams: [] });
    expect(plan.items).toEqual([]);
    expect(plan.queue).toEqual([]);
  });
});

describe("progress", () => {
  it("counts the current streak through yesterday and the longest run", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10", "2026-10-12", "2026-10-13"];
    expect(computeStreak(days, today)).toEqual({ current: 2, longest: 3 });
    expect(computeStreak([...days, today], today).current).toBe(3);
    expect(computeStreak(["2026-10-11"], today).current).toBe(0);
  });

  it("zero-fills daily activity", () => {
    const activity = dailyActivity([{ localDate: today, seconds: 30 }, { localDate: today, seconds: 20 }], today, 3);
    expect(activity).toEqual([
      { date: "2026-10-12", reviews: 0, seconds: 0 },
      { date: "2026-10-13", reviews: 0, seconds: 0 },
      { date: today, reviews: 2, seconds: 50 },
    ]);
  });

  it("splits cards into new, learning and mastered", () => {
    const s = (intervalDays: number): CardSchedule => ({ intervalDays, ease: 2.5, reps: 1, lapses: 0, dueDate: today });
    expect(cardMastery([{ schedule: null }, { schedule: s(1) }, { schedule: s(7) }, { schedule: s(30) }])).toEqual({ total: 4, mastered: 2, learning: 1, fresh: 1 });
  });

  it("clamps review seconds", () => {
    expect(clampReviewSeconds(undefined)).toBe(0);
    expect(clampReviewSeconds(-3)).toBe(0);
    expect(clampReviewSeconds(12.4)).toBe(12);
    expect(clampReviewSeconds(5000)).toBe(120);
  });
});
