import { describe, expect, it } from "vitest";
import { countByScope, filesHref, filterFiles, fileScopeParam, parseFileScope, resolveScope, uploadCourseFor } from "./sourceFiles";

const files = [
  { courseId: null, title: "Syllabus", fileName: "syllabus_v2.pdf" },
  { courseId: 3, title: "Week 1 slides", fileName: "w1.pptx" },
  { courseId: 3, title: "Reading", fileName: "Cell Biology.docx" },
  { courseId: 4, title: "Notes", fileName: "notes.txt" },
];

describe("sourceFiles", () => {
  it("parses the course parameter", () => {
    expect(parseFileScope("unfiled")).toBe("unfiled");
    expect(parseFileScope("12")).toBe(12);
    expect(parseFileScope("0")).toBe("all");
    expect(parseFileScope("abc")).toBe("all");
    expect(parseFileScope(null)).toBe("all");
  });

  it("filters by scope", () => {
    expect(filterFiles(files, "all", "")).toHaveLength(4);
    expect(filterFiles(files, "unfiled", "").map(f => f.title)).toEqual(["Syllabus"]);
    expect(filterFiles(files, 3, "").map(f => f.title)).toEqual(["Week 1 slides", "Reading"]);
  });

  it("searches the title and file name, ignoring case", () => {
    expect(filterFiles(files, "all", "  SLIDES ").map(f => f.title)).toEqual(["Week 1 slides"]);
    expect(filterFiles(files, "all", "cell biology").map(f => f.title)).toEqual(["Reading"]);
    expect(filterFiles(files, 4, "slides")).toEqual([]);
  });

  it("counts per scope", () => {
    const counts = countByScope(files);
    expect(counts.all).toBe(4);
    expect(counts.unfiled).toBe(1);
    expect(counts.byCourse.get(3)).toBe(2);
  });

  it("uploads into the open course only", () => {
    expect(uploadCourseFor(3)).toBe(3);
    expect(uploadCourseFor("unfiled")).toBeNull();
    expect(uploadCourseFor("all")).toBeNull();
  });

  it("falls back to all for a missing course and builds links", () => {
    expect(resolveScope(9, [3, 4])).toBe("all");
    expect(resolveScope(3, [3, 4])).toBe(3);
    expect(resolveScope("unfiled", [])).toBe("unfiled");
    expect(fileScopeParam("all")).toBeNull();
    expect(filesHref("all")).toBe("/files");
    expect(filesHref(3)).toBe("/files?course=3");
    expect(filesHref("unfiled")).toBe("/files?course=unfiled");
  });
});
