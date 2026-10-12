import { describe, expect, it } from "vitest";
import { allocateBudget, condenseTranscript, windowSegments } from "./transcriptBudget";

function lecture(minutes: number, wordsPerSegment = 40) {
  return Array.from({ length: minutes * 4 }, (_, i) => ({
    start: i * 15,
    end: i * 15 + 14,
    text: Array.from({ length: wordsPerSegment }, (_, w) => `word${i}_${w}`).join(" ") + ".",
  }));
}

describe("windowSegments", () => {
  it("merges segments into windows that each start with their first segment's time", () => {
    const windows = windowSegments([
      { start: 0, text: "a" },
      { start: 20, text: "b" },
      { start: 50, text: "c" },
      { start: 60, text: "  " },
    ]);
    expect(windows).toEqual([
      { start: 0, text: "a b" },
      { start: 50, text: "c" },
    ]);
  });
});

describe("condenseTranscript", () => {
  it("returns a short transcript whole, with timestamps", () => {
    const result = condenseTranscript({ segments: [{ start: 0, text: "Hello" }, { start: 75, text: "Second part" }] }, 1000);
    expect(result).toEqual({ text: "[0:00] Hello\n[1:15] Second part", timestamped: true, trimmed: false });
  });

  it("keeps a three-hour lecture under budget while covering start, middle and end", () => {
    const segments = lecture(180);
    const result = condenseTranscript({ segments }, 20_000);
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(20_000);
    expect(result.text).toContain("[0:00]");
    expect(result.text).toContain("[1:30:00]");
    expect(result.text).toMatch(/\[2:59:\d\d\]/);
  });

  it("thins out windows when even short lines would not fit", () => {
    const result = condenseTranscript({ segments: lecture(600, 10) }, 3_000);
    expect(result.text.length).toBeLessThanOrEqual(3_000);
    expect(result.text.startsWith("[0:00]")).toBe(true);
  });

  it("samples plain text from the start, middle and end when there are no segments", () => {
    const fullText = `${"start ".repeat(2000)}${"middle ".repeat(2000)}${"end ".repeat(2000)}`;
    const result = condenseTranscript({ segments: null, fullText }, 3_000);
    expect(result.timestamped).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(3_000);
    expect(result.text).toContain("start");
    expect(result.text).toContain("middle");
    expect(result.text).toContain("end");
  });
});

describe("allocateBudget", () => {
  it("gives everything when it fits", () => {
    expect(allocateBudget([100, 200], 1000)).toEqual([100, 200]);
  });

  it("never exceeds the total and keeps a floor for short recordings", () => {
    const shares = allocateBudget([200_000, 3_000, 90_000], 60_000, 4_000);
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000);
    expect(shares[1]).toBe(3_000);
    expect(shares[0]).toBeGreaterThan(shares[2]);
  });
});
