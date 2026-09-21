import { describe, expect, it } from "vitest";
import { formatRecordingDuration } from "./formatDuration";

describe("formatRecordingDuration", () => {
  it("shows seconds for anything under a minute instead of a misleading '0 minutes'", () => {
    // This was the actual bug: a real 8-second test recording rounded to
    // "0 minutes", indistinguishable from a broken/empty recording.
    expect(formatRecordingDuration(8)).toBe("8s");
    expect(formatRecordingDuration(45)).toBe("45s");
    expect(formatRecordingDuration(59)).toBe("59s");
  });

  it("shows minutes and seconds once a minute is reached", () => {
    expect(formatRecordingDuration(60)).toBe("1m 0s");
    expect(formatRecordingDuration(90)).toBe("1m 30s");
    expect(formatRecordingDuration(3599)).toBe("59m 59s");
  });

  it("shows hours and minutes for long recordings", () => {
    expect(formatRecordingDuration(3600)).toBe("1h 0m");
    expect(formatRecordingDuration(5400)).toBe("1h 30m");
    expect(formatRecordingDuration(7325)).toBe("2h 2m");
  });

  it("reports 'Unknown' rather than the more alarming 'N/A' when there is no duration", () => {
    // Uploads and link imports never had their real length measured, so this
    // is the common case, not an error state.
    expect(formatRecordingDuration(0)).toBe("Unknown");
    expect(formatRecordingDuration(null)).toBe("Unknown");
    expect(formatRecordingDuration(undefined)).toBe("Unknown");
  });

  it("treats invalid values as unknown rather than throwing", () => {
    expect(formatRecordingDuration(-5)).toBe("Unknown");
    expect(formatRecordingDuration(NaN)).toBe("Unknown");
  });

  it("rounds fractional seconds", () => {
    expect(formatRecordingDuration(8.6)).toBe("9s");
  });
});
