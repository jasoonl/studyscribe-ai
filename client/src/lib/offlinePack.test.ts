import { describe, expect, it } from "vitest";
import { buildOfflinePack, formatTimestamp, isNetworkFailure } from "./offlinePack";

describe("buildOfflinePack", () => {
  const recording = { id: 7, title: "Thermodynamics" };

  it("keeps segments, cards and notes trimmed to what offline use needs", () => {
    const pack = buildOfflinePack({
      userId: 3,
      recording,
      now: 1000,
      transcript: {
        fullText: "Hello there. Entropy rises.",
        segments: [
          { start: 0, speaker: "Prof. Lee", text: " Hello there. ", confidence: 0.9 } as never,
          { start: 4.5, speaker: "", text: "Entropy rises." },
          { start: 9, text: "   " },
        ],
      },
      flashcards: [{ id: 1, question: "Q", answer: "A", difficulty: "easy" } as never],
      notes: [{ id: 2, title: "", content: "# Notes" }, { id: 3, title: "Empty", content: " " }],
    });
    expect(pack).toEqual({
      recordingId: 7,
      userId: 3,
      title: "Thermodynamics",
      savedAt: 1000,
      segments: [
        { start: 0, speaker: "Prof. Lee", text: "Hello there." },
        { start: 4.5, speaker: null, text: "Entropy rises." },
      ],
      fullText: "Hello there. Entropy rises.",
      flashcards: [{ id: 1, question: "Q", answer: "A" }],
      notes: [{ id: 2, title: "Notes", content: "# Notes" }],
    });
  });

  it("falls back to the full text when the transcript was edited after transcription", () => {
    const pack = buildOfflinePack({
      userId: 1,
      recording,
      transcript: { fullText: "Edited words.", segments: [{ start: 0, text: "Original words." }] },
    });
    expect(pack.segments).toEqual([]);
    expect(pack.fullText).toBe("Edited words.");
  });

  it("copes with a recording that has nothing yet", () => {
    const pack = buildOfflinePack({ userId: 1, recording, transcript: null, flashcards: null, notes: undefined });
    expect(pack).toMatchObject({ segments: [], fullText: "", flashcards: [], notes: [] });
  });
});

describe("formatTimestamp", () => {
  it("formats minutes and hours", () => {
    expect(formatTimestamp(5)).toBe("0:05");
    expect(formatTimestamp(125.9)).toBe("2:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(-1)).toBe("0:00");
  });
});

describe("isNetworkFailure", () => {
  it("tells network errors from refusals", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new Error("Flashcard not found"))).toBe(false);
  });
});
