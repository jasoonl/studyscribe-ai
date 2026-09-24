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

  describe("long single-speaker turns", () => {
    // Builds one utterance of `count` words, one word per 500ms, with a sentence
    // ending every `sentenceEvery` words.
    function monologue(count: number, sentenceEvery: number) {
      const words = Array.from({ length: count }, (_, i) => ({
        text: (i + 1) % sentenceEvery === 0 ? `w${i}.` : `w${i}`,
        start: i * 500,
        end: i * 500 + 400,
        confidence: 0.9,
      }));
      return {
        speaker: "A",
        text: words.map((w) => w.text).join(" "),
        start: words[0].start,
        end: words[words.length - 1].end,
        words,
      };
    }

    it("splits a long monologue at sentence ends so timestamps are usable for seeking", () => {
      // 10 minutes of speech, a sentence roughly every 4s.
      const segments = normalizeDiarizedSegments([monologue(1200, 8)]);
      expect(segments.length).toBeGreaterThan(20);
      for (const segment of segments) {
        expect(segment.end - segment.start).toBeLessThanOrEqual(40);
        expect(segment.speaker).toBe("Speaker A");
      }
      // Ordered, contiguous in id, and starting where the speech starts.
      expect(segments[0].start).toBe(0);
      expect(segments.map((s) => s.id)).toEqual(segments.map((_, i) => `speaker-${i + 1}`));
      segments.slice(1).forEach((segment, i) => expect(segment.start).toBeGreaterThanOrEqual(segments[i].end));
    });

    it("loses no words when splitting", () => {
      const utterance = monologue(1200, 8);
      const rejoined = normalizeDiarizedSegments([utterance]).map((s) => s.text).join(" ");
      expect(rejoined.split(/\s+/)).toEqual(utterance.text.split(/\s+/));
    });

    it("force-splits a run with no sentence punctuation rather than emitting a giant segment", () => {
      const segments = normalizeDiarizedSegments([monologue(400, 100000)]);
      expect(segments.length).toBeGreaterThan(3);
      for (const segment of segments) expect(segment.end - segment.start).toBeLessThanOrEqual(40.5);
    });

    it("leaves a short turn untouched", () => {
      const segments = normalizeDiarizedSegments([monologue(20, 5)]);
      expect(segments).toHaveLength(1);
    });

    it("keeps a long turn whole when the provider gave no word timings", () => {
      const segments = normalizeDiarizedSegments([{ speaker: "A", text: "long talk", start: 0, end: 600_000 }]);
      expect(segments).toEqual([
        { id: "speaker-1", start: 0, end: 600, text: "long talk", speaker: "Speaker A", confidence: undefined },
      ]);
    });
  });
});
