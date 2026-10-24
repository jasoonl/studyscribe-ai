import { describe, expect, it } from "vitest";
import { acceptsAnswers, deadlineFor, defaultMinutes, secondsUsed, shouldAutoSubmit, timeLimitSeconds, timerState } from "./practiceTimer";

const start = new Date("2026-10-24T10:00:00Z");
const limit = 30 * 60;
const deadline = deadlineFor(start, limit);
const at = (seconds: number) => new Date(deadline.getTime() + seconds * 1000);

describe("limits", () => {
  it("defaults to a minute and a half per question within 5 to 180 minutes", () => {
    expect(defaultMinutes(10)).toBe(15);
    expect(defaultMinutes(3)).toBe(5);
    expect(defaultMinutes(15)).toBe(23);
    expect(defaultMinutes(500)).toBe(180);
  });

  it("applies extra time and clamps minutes", () => {
    expect(timeLimitSeconds(20)).toBe(1200);
    expect(timeLimitSeconds(20, 1.25)).toBe(1500);
    expect(timeLimitSeconds(20, 1.5)).toBe(1800);
    expect(timeLimitSeconds(20, 3)).toBe(1200);
    expect(timeLimitSeconds(1)).toBe(300);
    expect(timeLimitSeconds(999, 1.5)).toBe(180 * 60 * 1.5);
  });

  it("sets the deadline from the start", () => {
    expect(deadline.toISOString()).toBe("2026-10-24T10:30:00.000Z");
  });
});

describe("timerState around the deadline", () => {
  it("runs to the deadline, allows 15 seconds of grace, then expires", () => {
    expect(timerState(at(-60), deadline)).toBe("running");
    expect(timerState(at(0), deadline)).toBe("running");
    expect(timerState(at(0.001), deadline)).toBe("grace");
    expect(timerState(at(15), deadline)).toBe("grace");
    expect(timerState(at(15.001), deadline)).toBe("expired");
    expect(timerState(at(3600), deadline)).toBe("expired");
  });

  it("never expires an untimed session", () => {
    expect(timerState(at(99999), null)).toBe("running");
    expect(acceptsAnswers(at(99999), null)).toBe(true);
  });

  it("accepts answers through the grace period only", () => {
    expect(acceptsAnswers(at(15), deadline)).toBe(true);
    expect(acceptsAnswers(at(16), deadline)).toBe(false);
  });
});

describe("lazy auto-submit", () => {
  it("finalises only open sessions past deadline plus grace", () => {
    expect(shouldAutoSubmit(at(10), { submittedAt: null, deadlineAt: deadline })).toBe(false);
    expect(shouldAutoSubmit(at(16), { submittedAt: null, deadlineAt: deadline })).toBe(true);
    expect(shouldAutoSubmit(at(16), { submittedAt: at(-5), deadlineAt: deadline })).toBe(false);
    expect(shouldAutoSubmit(at(5000), { submittedAt: null, deadlineAt: null })).toBe(false);
  });

  it("resumes: a reload before the deadline keeps the same deadline", () => {
    // The deadline is stored, so the time left is what a new request sees.
    const reload = new Date(start.getTime() + 10 * 60 * 1000);
    expect(Math.round((deadline.getTime() - reload.getTime()) / 1000)).toBe(20 * 60);
    expect(timerState(reload, deadline)).toBe("running");
  });
});

describe("secondsUsed", () => {
  it("is the elapsed time, never more than the limit", () => {
    expect(secondsUsed(start, new Date(start.getTime() + 600_000), limit)).toBe(600);
    expect(secondsUsed(start, new Date(start.getTime() + 99_999_000), limit)).toBe(limit);
    expect(secondsUsed(start, new Date(start.getTime() + 99_000), null)).toBe(99);
    expect(secondsUsed(start, new Date(start.getTime() - 5000), limit)).toBe(0);
  });
});
