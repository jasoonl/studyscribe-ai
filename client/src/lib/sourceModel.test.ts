import { describe, expect, it } from "vitest";
import { failureReasonOf, stageOf, summaryPercent } from "./sourceModel";

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
  it("recognises the common failures without exposing the text", () => {
    expect(failureReasonOf("This PDF has no selectable text; scanned PDFs are not supported yet.")).toBe("needsOcr");
    expect(failureReasonOf("The file is too large")).toBe("tooLarge");
    expect(failureReasonOf("Too many pages")).toBe("tooLong");
    expect(failureReasonOf("The file does not match its type")).toBe("unreadable");
    expect(failureReasonOf("something odd")).toBe("failed");
    expect(failureReasonOf(null)).toBe("failed");
  });
});
