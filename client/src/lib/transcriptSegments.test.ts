import { describe, expect, it } from "vitest";
import { formatTranscriptTimestamp, getActiveTranscriptSegmentIndex } from "./transcriptSegments";

describe("transcript segment helpers", () => {
  const segments = [
    { id: "a", start: 0, end: 4.8, text: "Opening statement" },
    { id: "b", start: 4.8, end: 11, text: "Second statement" },
  ];

  it("formats timestamps consistently for segment controls", () => {
    expect(formatTranscriptTimestamp(0)).toBe("0:00");
    expect(formatTranscriptTimestamp(65.9)).toBe("1:05");
  });

  it("identifies the segment currently playing and none outside the available segments", () => {
    expect(getActiveTranscriptSegmentIndex(segments, 4.8)).toBe(1);
    expect(getActiveTranscriptSegmentIndex(segments, 12)).toBe(-1);
  });
});
