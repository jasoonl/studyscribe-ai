import { describe, expect, it } from "vitest";
import { normalizeDiarizedSegments } from "./speakerDiarization";

describe("speaker diarization normalization", () => {
  it("converts provider millisecond utterances into app timestamp segments with visible speaker labels", () => {
    expect(normalizeDiarizedSegments([
      { speaker: "A", text: " Welcome to the lecture. ", start: 250, end: 2_750, confidence: 0.97 },
      { speaker: "B", text: "Thank you.", start: 3_000, end: 3_500, confidence: 0.92 },
    ])).toEqual([
      { id: "speaker-1", start: 0.25, end: 2.75, text: "Welcome to the lecture.", speaker: "Speaker A", confidence: 0.97 },
      { id: "speaker-2", start: 3, end: 3.5, text: "Thank you.", speaker: "Speaker B", confidence: 0.92 },
    ]);
  });

  it("excludes empty utterances so the transcript only includes playable speaker turns", () => {
    expect(normalizeDiarizedSegments([
      { speaker: "A", text: "  ", start: 0, end: 10 },
    ])).toEqual([]);
  });
});
