import { describe, expect, it } from "vitest";
import {
  actionItemKey,
  buildActionItemsMessages,
  countOccurrences,
  insightKindOf,
  isInsightNote,
  normalizeChapters,
  normalizeExtractedActionItems,
  normalizeKeyTerms,
  parseJsonContent,
  suggestedChapterCount,
} from "./studyExtraction";

describe("parseJsonContent", () => {
  it("reads JSON, including inside a code fence", () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonContent("not json")).toBeNull();
    expect(parseJsonContent(undefined)).toBeNull();
  });
});

describe("normalizeExtractedActionItems", () => {
  const options = { recordedOn: "2026-10-12", durationSeconds: 3000 };

  it("keeps valid items and fills defaults", () => {
    const items = normalizeExtractedActionItems(
      {
        items: [
          { text: "  Submit   lab report 3 ", kind: "assignment", owner: null, dueDate: "2026-10-17", dueText: "next Friday", atSeconds: 2810.6 },
          { text: "Read chapter 4", kind: "weird", owner: "", dueDate: null, dueText: null, atSeconds: null },
        ],
      },
      options,
    );
    expect(items).toEqual([
      { text: "Submit lab report 3", kind: "assignment", owner: null, dueDate: "2026-10-17", dueText: "next Friday", atSeconds: 2810 },
      { text: "Read chapter 4", kind: "task", owner: null, dueDate: null, dueText: null, atSeconds: null },
    ]);
  });

  it("drops duplicates, empty text, impossible dates and timestamps past the end", () => {
    const items = normalizeExtractedActionItems(
      [
        { text: "Revise for the midterm", kind: "exam", dueDate: "2026-02-30", atSeconds: 9999 },
        { text: "revise for the midterm!", kind: "exam" },
        { text: "", kind: "task" },
        { text: "Pay the fee", kind: "task", dueDate: "2040-01-01" },
      ],
      options,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ text: "Revise for the midterm", dueDate: null, atSeconds: null });
    expect(items[1]).toMatchObject({ text: "Pay the fee", dueDate: null });
  });

  it("returns nothing for malformed output", () => {
    expect(normalizeExtractedActionItems(null, options)).toEqual([]);
    expect(normalizeExtractedActionItems({ items: "x" }, options)).toEqual([]);
  });

  it("matches the same task written differently", () => {
    expect(actionItemKey("Hand in: Essay 2.")).toBe(actionItemKey("hand in essay 2"));
  });

  it("tells the model the recording date so relative dates resolve", () => {
    const [system] = buildActionItemsMessages({ title: "T", audience: "student", recordedOn: "2026-10-12", transcript: "x", timestamped: true });
    expect(system.content).toContain("2026-10-12");
    expect(system.content).toContain("[m:ss]");
  });
});

describe("normalizeKeyTerms", () => {
  const text = "The Krebs cycle runs in the mitochondria. ATP synthase makes ATP. The Krebs Cycle again.";

  it("keeps only terms found in the transcript, without repeats", () => {
    expect(normalizeKeyTerms({ terms: ["Krebs cycle", "krebs cycle", "\"ATP synthase\"", "Photosynthesis", "x", "mitochondria."] }, text)).toEqual([
      "Krebs cycle",
      "ATP synthase",
      "mitochondria",
    ]);
  });

  it("counts case-insensitive occurrences", () => {
    expect(countOccurrences(["Krebs cycle", "ATP"], text)).toEqual({ "Krebs cycle": 2, ATP: 2 });
  });
});

describe("normalizeChapters", () => {
  it("sorts, drops out-of-range and untitled entries, merges close starts and starts at zero", () => {
    const chapters = normalizeChapters(
      {
        chapters: [
          { start: 600, title: "Glycolysis", summary: "Steps." },
          { start: 45, title: "Why cells need energy", summary: "" },
          { start: 610, title: "Too close", summary: "" },
          { start: 5000, title: "Past the end", summary: "" },
          { start: 900, title: "", summary: "No title" },
        ],
      },
      1200,
    );
    expect(chapters).toEqual([
      { start: 0, title: "Why cells need energy", summary: "" },
      { start: 600, title: "Glycolysis", summary: "Steps." },
    ]);
  });

  it("suggests more chapters for longer recordings, within limits", () => {
    expect(suggestedChapterCount(300)).toBe(2);
    expect(suggestedChapterCount(3120)).toBe(7);
    expect(suggestedChapterCount(4 * 3600)).toBe(12);
    expect(suggestedChapterCount(null)).toBe(6);
  });
});

describe("insight notes", () => {
  it("recognises key terms and chapter notes and nothing else", () => {
    expect(insightKindOf({ insight: "chapters" })).toBe("chapters");
    expect(isInsightNote({ insight: "key_terms" })).toBe(true);
    expect(isInsightNote({ template: "lecture" })).toBe(false);
    expect(isInsightNote(null)).toBe(false);
  });
});
