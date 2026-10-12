import { describe, expect, it } from "vitest";
import { createTranscriptExport } from "./transcriptExports";

const segments = [
  { id: "1", start: 0, end: 2.5, text: "Welcome back.", speaker: "Prof. Lee" },
  { id: "2", start: 2.5, end: 65.04, text: "Today:  entropy.", speaker: "Prof. Lee" },
  { id: "3", start: 3725.2, end: 3727, text: "Question?", speaker: "Student" },
];

describe("createTranscriptExport", () => {
  it("writes SRT cues with comma milliseconds, hours and speaker names", () => {
    const { content, extension } = createTranscriptExport({ segments, fullText: "", title: "Physics" }, "srt");
    expect(extension).toBe("srt");
    expect(content).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\nProf. Lee: Welcome back.\n\n" +
        "2\n00:00:02,500 --> 00:01:05,040\nProf. Lee: Today: entropy.\n\n" +
        "3\n01:02:05,200 --> 01:02:07,000\nStudent: Question?\n",
    );
  });

  it("writes WebVTT with a header and dot milliseconds", () => {
    const { content } = createTranscriptExport({ segments: segments.slice(0, 1), fullText: "", title: "Physics" }, "vtt");
    expect(content).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nProf. Lee: Welcome back.\n");
  });

  it("writes plain text with a speaker heading only when the speaker changes", () => {
    const fullText = "Welcome back. Today: entropy. Question?";
    const { content } = createTranscriptExport({ segments, fullText, title: "Physics" }, "txt");
    expect(content).toBe("Physics\n\nProf. Lee:\n[0:00] Welcome back.\n[0:02] Today: entropy.\n\nStudent:\n[62:05] Question?\n");
  });

  it("keeps the user's edits when the full text no longer matches the segments", () => {
    const { content } = createTranscriptExport({ segments, fullText: "Welcome back. Today: entropy, part two.", title: "Physics" }, "txt");
    expect(content).toBe("Physics\n\nWelcome back. Today: entropy, part two.\n");
  });

  it("falls back to the full text when there are no segments", () => {
    const { content } = createTranscriptExport({ segments: [], fullText: " Edited text. ", title: "Notes" }, "txt");
    expect(content).toBe("Notes\n\nEdited text.\n");
  });
});
