import { describe, expect, it } from "vitest";
import { renameSpeakerInSegments, speakerRenameInputSchema, transcriptUpdateInputSchema } from "./transcriptInput";

describe("transcriptUpdateInputSchema", () => {
  it("accepts a non-empty transcript update", () => {
    expect(transcriptUpdateInputSchema.parse({ recordingId: 42, fullText: "Edited lecture notes." })).toMatchObject({
      recordingId: 42,
      fullText: "Edited lecture notes.",
    });
  });

  it("rejects empty transcript updates", () => {
    expect(() => transcriptUpdateInputSchema.parse({ recordingId: 42, fullText: "  " })).toThrow("Transcript cannot be empty");
  });
});

describe("renameSpeakerInSegments", () => {
  const segments = [
    { id: "1", start: 0, end: 2, text: "Welcome.", speaker: "A" },
    { id: "2", start: 2, end: 4, text: "Thanks.", speaker: "B" },
    { id: "3", start: 4, end: 6, text: "Let's begin.", speaker: "A" },
  ];

  it("renames every segment of that speaker and leaves the rest", () => {
    const renamed = renameSpeakerInSegments(segments, "A", "  Prof. Lee ");
    expect(renamed?.map(segment => segment.speaker)).toEqual(["Prof. Lee", "B", "Prof. Lee"]);
    expect(segments[0].speaker).toBe("A");
  });

  it("merges two speakers when given an existing name", () => {
    expect(renameSpeakerInSegments(segments, "B", "A")?.every(segment => segment.speaker === "A")).toBe(true);
  });

  it("returns null for a speaker that is not in the transcript", () => {
    expect(renameSpeakerInSegments(segments, "C", "Someone")).toBeNull();
  });
});

describe("speakerRenameInputSchema", () => {
  it("rejects blank and overly long names", () => {
    expect(() => speakerRenameInputSchema.parse({ recordingId: 1, from: "A", to: "   " })).toThrow("Speaker name cannot be empty");
    expect(() => speakerRenameInputSchema.parse({ recordingId: 1, from: "A", to: "x".repeat(61) })).toThrow("Speaker name is too long");
  });
});
