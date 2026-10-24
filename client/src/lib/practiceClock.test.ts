import { describe, expect, it } from "vitest";
import {
  alreadyPassed, announcementSpec, clockOffset, serverNow, defaultMinutes, formatClock, isLowTime, minutesWithExtra, reachedThresholds, remainingSeconds, retryDelayMs, secondsUsed, thresholdsFor,
} from "./practiceClock";

describe("server deadline clock", () => {
  it("follows the server deadline whatever the device clock says", () => {
    // Server said 1000 and the monotonic clock read 50000 on arrival; no round trip to account for.
    const offset = clockOffset(1000, 50_000, 0, 999_999);
    expect(offset).toBe(-49_000);
    // 90s later (monotonic), the server's time is 91000: a 91000 deadline is reached.
    expect(remainingSeconds(181_000, serverNow(offset, 50_000))).toBe(180);
    expect(remainingSeconds(91_000, serverNow(offset, 140_000))).toBe(0);
  });
  it("is not moved by a change of the device clock mid-exam", () => {
    const offset = clockOffset(0, 1000, 0, Date.now());
    // The monotonic reading is what is used: the device Date is never read after the anchor.
    const before = remainingSeconds(600_000, serverNow(offset, 1000 + 100_000));
    const afterClockJump = remainingSeconds(600_000, serverNow(offset, 1000 + 100_000));
    expect(before).toBe(500);
    expect(afterClockJump).toBe(before);
  });
  it("counts half the round trip as already gone when the answer arrives", () => {
    expect(clockOffset(10_000, 500, 200)).toBe(10_000 + 100 - 500);
    expect(clockOffset(10_000, 500, -5)).toBe(10_000 - 500);
  });
  it("falls back to the device clock when the server's time is not a number", () => {
    expect(clockOffset(Number.NaN, 400, 0, 5000)).toBe(4600);
    expect(clockOffset(Number.POSITIVE_INFINITY, 400, 0, 5000)).toBe(4600);
    expect(clockOffset(1000, Number.NaN, 0, 5000)).toBe(0);
  });
  it("treats a broken time as unknown, not zero", () => {
    expect(remainingSeconds(Number.NaN, 10)).toBeNull();
    expect(remainingSeconds(10_000, Number.NaN)).toBeNull();
    expect(remainingSeconds(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });
  it("rounds up and never goes negative", () => {
    expect(remainingSeconds(10_001, 10_000)).toBe(1);
    expect(remainingSeconds(10_000, 20_000)).toBe(0);
  });
  it("formats the clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-3)).toBe("00:00");
    expect(formatClock(Number.NaN)).toBe("00:00");
  });
  it("measures time used within the limit", () => {
    expect(secondsUsed(600, 150)).toBe(450);
    expect(secondsUsed(600, 700)).toBe(0);
    expect(secondsUsed(600, 0)).toBe(600);
  });
  it("marks the last minute", () => {
    expect(isLowTime(61)).toBe(false);
    expect(isLowTime(60)).toBe(true);
  });
});

describe("announcement thresholds", () => {
  it("covers half time, 10, 5 and 1 minute, 30 seconds and the end for a long exam", () => {
    expect(thresholdsFor(3600).map(t => t.id)).toEqual(["half", "600", "300", "60", "30", "0"]);
    expect(thresholdsFor(3600)[0].seconds).toBe(1800);
  });
  it("skips points that do not fit inside a short exam", () => {
    expect(thresholdsFor(300).map(t => t.id)).toEqual(["half", "60", "30", "0"]);
    expect(thresholdsFor(120).map(t => t.id)).toEqual(["60", "30", "0"]);
  });
  it("collapses points at the same second", () => {
    const ids = thresholdsFor(600).map(t => t.id);
    expect(ids.filter(id => id === "300" || id === "half")).toEqual(["300"]);
  });
  it("announces only at thresholds, never once a second", () => {
    const handled: string[] = [];
    const spoken: string[] = [];
    for (let remaining = 3600; remaining >= 0; remaining--) {
      const { announce, mark } = reachedThresholds(3600, remaining, handled);
      handled.push(...mark);
      if (announce) spoken.push(announce.id);
    }
    expect(spoken).toEqual(["half", "600", "300", "60", "30", "0"]);
  });
  it("says only the most urgent point after a jump and does not read the rest late", () => {
    const first = reachedThresholds(3600, 20, []);
    expect(first.announce?.id).toBe("30");
    expect(first.mark).toEqual(["half", "600", "300", "60", "30"]);
    expect(reachedThresholds(3600, 19, first.mark).announce).toBeNull();
  });
  it("starts quietly when an exam is resumed part way", () => {
    const passed = alreadyPassed(3600, 200);
    expect(passed).toEqual(["half", "600", "300"]);
    expect(reachedThresholds(3600, 200, passed).announce).toBeNull();
    expect(reachedThresholds(3600, 60, passed).announce?.id).toBe("60");
  });
  it("has nothing for an exam with no length", () => {
    expect(thresholdsFor(0)).toEqual([]);
  });
});

describe("what is announced", () => {
  it("turns a threshold into words as data", () => {
    expect(announcementSpec("half")).toEqual({ kind: "half", count: 0 });
    expect(announcementSpec("0")).toEqual({ kind: "over", count: 0 });
    expect(announcementSpec("30")).toEqual({ kind: "seconds", count: 30 });
    expect(announcementSpec("60")).toEqual({ kind: "minutes", count: 1 });
    expect(announcementSpec("600")).toEqual({ kind: "minutes", count: 10 });
  });
});

describe("exam settings and retries", () => {
  it("defaults to a minute and a half a question, within limits", () => {
    expect(defaultMinutes(10)).toBe(15);
    expect(defaultMinutes(1)).toBe(5);
    expect(defaultMinutes(200)).toBe(180);
  });
  it("adds extra time and rounds up", () => {
    expect(minutesWithExtra(15, 1)).toBe(15);
    expect(minutesWithExtra(15, 1.25)).toBe(19);
    expect(minutesWithExtra(15, 1.5)).toBe(23);
    expect(minutesWithExtra(170, 1.5)).toBe(180);
  });
  it("backs off when sending answers fails, up to 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelayMs)).toEqual([2000, 4000, 8000, 15000, 30000, 30000, 30000]);
  });
});
