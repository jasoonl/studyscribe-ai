import { describe, expect, it } from "vitest";
import { failureReasonOf, filterFlags, isLikelyOnTest, isRetryableReason, stageOf, summaryPercent } from "./sourceModel";

describe("stageOf", () => {
  it("folds the server statuses into the stages people see", () => {
    expect(stageOf("uploaded")).toBe("waiting");
    expect(stageOf("extracting")).toBe("reading");
    expect(stageOf("extracted")).toBe("summarizing");
    expect(stageOf("analyzing")).toBe("summarizing");
    expect(stageOf("ready")).toBe("ready");
    expect(stageOf("failed")).toBe("failed");
  });
});

describe("summaryPercent", () => {
  it("is null until the parts are counted and never shows 100 before ready", () => {
    expect(summaryPercent({ status: "extracting", partCount: 0, partsDone: 0 })).toBeNull();
    expect(summaryPercent({ status: "analyzing", partCount: 4, partsDone: 1 })).toBe(25);
    expect(summaryPercent({ status: "analyzing", partCount: 4, partsDone: 4 })).toBe(99);
    expect(summaryPercent({ status: "ready", partCount: 4, partsDone: 4 })).toBe(100);
  });
});

describe("failureReasonOf", () => {
  // These are the exact sentences server/sourceExtract.ts raises.
  const cases: [string, string, ReturnType<typeof failureReasonOf>][] = [
    ["pdf scan", "This PDF has no selectable text. Scanned PDFs are not supported yet; upload a version with real text.", "needsOcr"],
    ["password", "This PDF is password protected. Remove the password and upload it again.", "password"],
    ["damaged pdf", "This PDF is damaged or not a real PDF, so its text could not be read.", "unreadable"],
    ["damaged zip", "This file is damaged and could not be opened.", "unreadable"],
    ["not pptx", "This file does not look like a PowerPoint presentation.", "unreadable"],
    ["not docx", "This file does not look like a Word document.", "unreadable"],
    ["mismatch", "This file does not look like a real PDF file. Check the file and try again.", "unreadable"],
    ["empty", "That file is empty.", "empty"],
    ["not utf8", "This text file is not UTF-8. Re-save it as UTF-8 and try again.", "encoding"],
    ["binary text", "This file is not plain text. Save it as UTF-8 text or Markdown and try again.", "encoding"],
    ["too large", "That file is larger than the size limit.", "tooLarge"],
    ["too large xml", "This file is too large to read safely.", "tooLarge"],
    ["chars", "This file has more than 400,000 characters of text. Upload a shorter part of it.", "tooLong"],
    ["units", "This file has more than 400 pages, slides or sections. Upload a shorter part of it.", "tooLong"],
    ["pdf pages", "This PDF has 900 pages; the limit is 400. Upload a shorter part of it.", "tooLong"],
    ["slow", "Reading this PDF took too long. Upload a shorter part of it.", "tooLong"],
  ];
  for (const [name, sentence, reason] of cases) {
    it(`reads the server sentence for ${name}`, () => expect(failureReasonOf(sentence)).toBe(reason));
  }

  it("gives scan advice only for a PDF when no text was found", () => {
    const sentence = "No text could be found in this file.";
    expect(failureReasonOf(sentence, "pdf")).toBe("needsOcr");
    expect(failureReasonOf(sentence, "docx")).toBe("noText");
    expect(failureReasonOf(sentence, "text")).toBe("noText");
    expect(failureReasonOf(sentence, "pptx")).toBe("noText");
  });

  it("falls back to a generic reason, and only that one is retryable", () => {
    expect(failureReasonOf("something odd")).toBe("failed");
    expect(failureReasonOf(null)).toBe("failed");
    expect(isRetryableReason("failed")).toBe(true);
    for (const reason of ["needsOcr", "noText", "password", "empty", "encoding", "tooLarge", "tooLong", "unreadable"] as const) expect(isRetryableReason(reason)).toBe(false);
  });
});

describe("likely on a test", () => {
  it("counts exam points and importance 2 or more", () => {
    expect(isLikelyOnTest({ kind: "exam_point", importance: 1 })).toBe(true);
    expect(isLikelyOnTest({ kind: "definition", importance: 2 })).toBe(true);
    expect(isLikelyOnTest({ kind: "date", importance: 1 })).toBe(false);
  });
  it("filters without changing the original list", () => {
    const flags = [
      { kind: "date" as const, importance: 1 },
      { kind: "formula" as const, importance: 3 },
    ];
    expect(filterFlags(flags, "test")).toEqual([flags[1]]);
    expect(filterFlags(flags, "all")).toEqual(flags);
  });
});
