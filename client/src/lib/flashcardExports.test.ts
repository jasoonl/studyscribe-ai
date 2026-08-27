import { describe, expect, it } from "vitest";
import { createFlashcardExport } from "./flashcardExports";

const cards = [
  { question: "What\nis active recall?", answer: "Retrieving information\tfrom memory", difficulty: "medium" },
  { question: "What is spacing?", answer: "Reviewing over time" },
];

describe("createFlashcardExport", () => {
  it("creates clean tab-separated cards compatible with Quizlet and Anki imports", () => {
    const result = createFlashcardExport(cards, "tsv");
    expect(result.extension).toBe("tsv");
    expect(result.content).toBe("What is active recall?\tRetrieving information from memory\nWhat is spacing?\tReviewing over time");
  });

  it("creates structured Markdown for Notion import or copy-paste", () => {
    const result = createFlashcardExport(cards, "markdown", "Biology review");
    expect(result.extension).toBe("md");
    expect(result.content).toContain("# Biology review");
    expect(result.content).toContain("## 1. What\nis active recall?");
    expect(result.content).toContain("_Difficulty: medium_");
  });
});
