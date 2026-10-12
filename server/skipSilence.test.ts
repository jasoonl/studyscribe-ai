import { describe, expect, it } from "vitest";
import { computeSilentGaps, skipTargetAt, totalSilence } from "@shared/silence";

describe("computeSilentGaps", () => {
  it("finds gaps between segments longer than the threshold, padded on both sides", () => {
    const gaps = computeSilentGaps(
      [
        { start: 0.5, end: 4 },
        { start: 5, end: 9 }, // 1s gap: kept
        { start: 15, end: 20 }, // 6s gap: skipped
      ],
      { minGapSeconds: 2, paddingSeconds: 0.5 },
    );
    expect(gaps).toEqual([{ start: 9.5, end: 14.5 }]);
  });

  it("skips leading silence and trailing silence up to the duration", () => {
    const gaps = computeSilentGaps([{ start: 10, end: 20 }], { minGapSeconds: 2, paddingSeconds: 0.5, duration: 30 });
    expect(gaps).toEqual([
      { start: 0, end: 9.5 },
      { start: 20.5, end: 30 },
    ]);
  });

  it("merges overlapping speakers so overlap is never treated as silence", () => {
    const gaps = computeSilentGaps(
      [
        { start: 0, end: 10 },
        { start: 8, end: 12 },
        { start: 11, end: 13 },
        { start: 20, end: 22 },
      ],
      { minGapSeconds: 2, paddingSeconds: 0 },
    );
    expect(gaps).toEqual([{ start: 13, end: 20 }]);
  });

  it("ignores unsorted, invalid and empty input", () => {
    expect(computeSilentGaps([])).toEqual([]);
    const gaps = computeSilentGaps(
      [
        { start: 30, end: 35 },
        { start: Number.NaN, end: 4 },
        { start: 0, end: 5 },
        { start: 7, end: 6 },
      ],
      { minGapSeconds: 2, paddingSeconds: 0 },
    );
    expect(gaps).toEqual([{ start: 5, end: 30 }]);
  });

  it("drops gaps that padding would shrink to nothing", () => {
    expect(computeSilentGaps([{ start: 0, end: 1 }, { start: 3.1, end: 4 }], { minGapSeconds: 2, paddingSeconds: 1 })).toEqual([]);
  });
});

describe("skipTargetAt", () => {
  const gaps = [
    { start: 9.5, end: 14.5 },
    { start: 30, end: 40 },
  ];

  it("jumps to the end of the gap the playhead is in", () => {
    expect(skipTargetAt(gaps, 9.5)).toBe(14.5);
    expect(skipTargetAt(gaps, 12)).toBe(14.5);
    expect(skipTargetAt(gaps, 35)).toBe(40);
  });

  it("does nothing during speech or right at a gap's end", () => {
    expect(skipTargetAt(gaps, 5)).toBeNull();
    expect(skipTargetAt(gaps, 14.48)).toBeNull();
    expect(skipTargetAt(gaps, 20)).toBeNull();
  });

  it("totals the skippable time", () => {
    expect(totalSilence(gaps)).toBe(15);
  });
});
