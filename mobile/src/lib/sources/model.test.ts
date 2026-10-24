import { filterFlags, failureReasonOf, failureText, formatBytes, isLikelyOnTest, isRetryableReason, kindLabel, stageOf, summaryPercent, SOURCE_LIMITS } from "./model";

describe("stageOf", () => {
  it("folds statuses into stages", () => {
    expect(stageOf("uploaded")).toBe("waiting");
    expect(stageOf("extracting")).toBe("reading");
    expect(stageOf("extracted")).toBe("summarizing");
    expect(stageOf("analyzing")).toBe("summarizing");
    expect(stageOf("ready")).toBe("ready");
    expect(stageOf("failed")).toBe("failed");
  });
});

describe("summaryPercent", () => {
  it("is null until the part count is known, 100 when ready, capped at 99 otherwise", () => {
    expect(summaryPercent({ status: "extracting", partCount: 0, partsDone: 0 })).toBeNull();
    expect(summaryPercent({ status: "analyzing", partCount: 4, partsDone: 1 })).toBe(25);
    expect(summaryPercent({ status: "analyzing", partCount: 4, partsDone: 4 })).toBe(99);
    expect(summaryPercent({ status: "ready", partCount: 0, partsDone: 0 })).toBe(100);
  });
});

describe("failureReasonOf with the server's exact sentences", () => {
  const cases: [string, string | undefined, string][] = [
    ["This PDF is password protected. Remove the password and upload it again.", "pdf", "password"],
    ["This PDF has no selectable text. Scanned PDFs are not supported yet; upload a version with real text.", "pdf", "needsOcr"],
    ["No text could be found in this file.", "pdf", "needsOcr"],
    ["No text could be found in this file.", "pptx", "noText"],
    ["No text could be found in this file.", "docx", "noText"],
    ["That file is empty.", "text", "empty"],
    ["This file is not plain text. Save it as UTF-8 text or Markdown and try again.", "text", "encoding"],
    ["This text file is not UTF-8. Re-save it as UTF-8 and try again.", "text", "encoding"],
    ["That file is larger than the size limit.", "pdf", "tooLarge"],
    ["This file is too large to read safely.", "pptx", "tooLarge"],
    ["This file has more than 400,000 characters of text. Upload a shorter part of it.", "docx", "tooLong"],
    ["This file has more than 400 pages, slides or sections. Upload a shorter part of it.", "pptx", "tooLong"],
    ["This PDF has 500 pages; the limit is 400. Upload a shorter part of it.", "pdf", "tooLong"],
    ["Reading this PDF took too long. Upload a shorter part of it.", "pdf", "tooLong"],
    ["This file is damaged and could not be opened.", "pptx", "unreadable"],
    ["This PDF is damaged or not a real PDF, so its text could not be read.", "pdf", "unreadable"],
    ["This file does not look like a PowerPoint presentation.", "pptx", "unreadable"],
    ["This file does not look like a Word document.", "docx", "unreadable"],
  ];
  it.each(cases)("%s (%s) -> %s", (message, kind, reason) => {
    expect(failureReasonOf(message, kind as never)).toBe(reason);
  });

  it("treats empty or unknown messages as an unexplained failure", () => {
    expect(failureReasonOf(null)).toBe("failed");
    expect(failureReasonOf("")).toBe("failed");
    expect(failureReasonOf("Something odd happened")).toBe("failed");
  });
});

describe("isRetryableReason and failureText", () => {
  it("retries only unexplained failures, and every reason has a plain sentence", () => {
    expect(isRetryableReason("failed")).toBe(true);
    expect(isRetryableReason("password")).toBe(false);
    for (const reason of ["needsOcr", "noText", "password", "empty", "encoding", "tooLarge", "tooLong", "unreadable", "limitReached", "failed"] as const) {
      const text = failureText(reason);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/—|plan|upgrade|price/i);
    }
  });
});

describe("flags", () => {
  const flags = [
    { kind: "exam_point" as const, importance: 1 },
    { kind: "definition" as const, importance: 3 },
    { kind: "definition" as const, importance: 2 },
    { kind: "example" as const, importance: 1 },
  ];
  it("likely on a test means an exam point or importance 2 and up", () => {
    expect(isLikelyOnTest(flags[0])).toBe(true);
    expect(isLikelyOnTest(flags[3])).toBe(false);
    expect(filterFlags(flags, "test")).toHaveLength(3);
    expect(filterFlags(flags, "all")).toHaveLength(4);
  });
});

describe("labels and limits", () => {
  it("names kinds and formats sizes", () => {
    expect(kindLabel("pdf")).toBe("PDF");
    expect(kindLabel("pptx")).toBe("Slides");
    expect(kindLabel("docx")).toBe("Document");
    expect(kindLabel("text")).toBe("Notes");
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2MB");
    expect(SOURCE_LIMITS.extensions).toContain("pdf");
  });
});

describe("generic read failure", () => {
  it("maps the server's catch-all sentence to a retryable failure", () => {
    expect(failureReasonOf("We could not read this file. It may be damaged. Try uploading it again.", "pdf")).toBe("failed");
    expect(failureReasonOf("This file is damaged and could not be opened.", "pptx")).toBe("unreadable");
  });
});
