import { describe, expect, it } from "vitest";
import { elapsedSeconds, formatClockTime, idleClock, pauseClock, resumeClock, startClock } from "./recordingClock";

describe("recordingClock", () => {
  it("counts wall-clock time however rarely it is read", () => {
    const clock = startClock(1_000);
    // A background tab may not re-render for minutes; the reading is still exact.
    expect(elapsedSeconds(clock, 1_000 + 45 * 60_000)).toBe(45 * 60);
  });

  it("excludes paused stretches", () => {
    let clock = startClock(0);
    clock = pauseClock(clock, 10_000);
    expect(elapsedSeconds(clock, 70_000)).toBe(10);
    clock = resumeClock(clock, 70_000);
    expect(elapsedSeconds(clock, 75_500)).toBe(15);
  });

  it("ignores repeated pause or resume calls", () => {
    let clock = startClock(0);
    clock = pauseClock(clock, 5_000);
    clock = pauseClock(clock, 9_000);
    clock = resumeClock(clock, 10_000);
    clock = resumeClock(clock, 12_000);
    expect(elapsedSeconds(clock, 13_000)).toBe(8);
  });

  it("reads zero when idle", () => {
    expect(elapsedSeconds(idleClock, 123_456)).toBe(0);
  });
});

describe("formatClockTime", () => {
  it("shows minutes and seconds under an hour", () => {
    expect(formatClockTime(0)).toBe("00:00");
    expect(formatClockTime(59 * 60 + 7)).toBe("59:07");
  });

  it("adds hours for long lectures", () => {
    expect(formatClockTime(2 * 3600 + 5 * 60 + 9)).toBe("2:05:09");
  });
});
