import { describe, expect, it } from "vitest";
import { chunkMarkdown, chunkTranscript, hashChunk, parseTranslatedLines, TRANSLATION_CHUNK_CHARS } from "./translationChunks";

const sentence = (n: number) => `This is sentence number ${n} about cellular respiration and ATP.`;

function lectureSegments(count: number) {
  return Array.from({ length: count }, (_, i) => ({ start: i * 5, end: i * 5 + 4, text: sentence(i), speaker: i % 10 < 7 ? "Professor" : "Student" }));
}

describe("transcript chunks", () => {
  it("keeps whole lines, with times and speakers, under the size limit", () => {
    const segments = lectureSegments(400);
    const fullText = segments.map((segment) => segment.text).join(" ");
    const chunks = chunkTranscript(fullText, segments);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.lines).not.toBeNull();
      expect(chunk.text.length).toBeLessThanOrEqual(TRANSLATION_CHUNK_CHARS);
    }
    // Every line appears once, in order, with its own time and speaker.
    const flattened = chunks.flatMap((chunk) => chunk.lines!);
    expect(flattened).toHaveLength(400);
    expect(flattened[128]).toEqual({ start: 640, speaker: "Student", text: sentence(128) });
  });

  it("uses the full text without times when the transcript was edited", () => {
    const segments = lectureSegments(20);
    const edited = segments.map((segment) => segment.text).join(" ").replace("number 3", "number three");
    const chunks = chunkTranscript(edited, segments);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].lines).toBeNull();
    expect(chunks[0].text).toContain("number three");
  });

  it("handles a transcript with no timed lines, and splits a giant paragraph by sentence", () => {
    const text = Array.from({ length: 200 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkTranscript(text, []);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.text.length <= TRANSLATION_CHUNK_CHARS && chunk.lines === null)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(" ")).toBe(text);
  });

  it("gives the same chunk the same hash and an edited chunk a new one", () => {
    const segments = lectureSegments(10);
    const fullText = segments.map((segment) => segment.text).join(" ");
    const [a] = chunkTranscript(fullText, segments);
    const [b] = chunkTranscript(fullText, segments);
    expect(a.hash).toBe(b.hash);
    const renamed = segments.map((segment) => ({ ...segment, speaker: segment.speaker === "Student" ? "Maya" : segment.speaker }));
    expect(chunkTranscript(fullText, renamed)[0].hash).not.toBe(a.hash);
    expect(hashChunk("x", null)).not.toBe(hashChunk("y", null));
  });
});

describe("markdown chunks", () => {
  it("keeps a short document in one chunk", () => {
    expect(chunkMarkdown("# Notes\n\n- one\n- two")).toHaveLength(1);
  });

  it("splits at paragraph breaks and keeps headings with what follows", () => {
    const sections = Array.from({ length: 30 }, (_, i) => `## Section ${i}\n\n${sentence(i)} ${sentence(i + 100)} ${sentence(i + 200)}`).join("\n\n");
    const chunks = chunkMarkdown(sections, 800);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(800);
      expect(chunk.text.startsWith("## Section")).toBe(true);
      expect(chunk.text.trimEnd().endsWith("##")).toBe(false);
    }
  });
});

describe("translated lines", () => {
  it("accepts exactly one string per source line", () => {
    expect(parseTranslatedLines({ lines: [" uno ", "dos"] }, 2)).toEqual(["uno", "dos"]);
    expect(parseTranslatedLines({ lines: ["uno"] }, 2)).toBeNull();
    expect(parseTranslatedLines({ lines: ["uno", 2] }, 2)).toBeNull();
    expect(parseTranslatedLines(null, 0)).toBeNull();
  });
});
