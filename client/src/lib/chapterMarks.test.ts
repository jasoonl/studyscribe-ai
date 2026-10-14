import { describe, expect, it } from "vitest";
import { chapterMarkPositions } from "./chapterMarks";

describe("chapterMarkPositions", () => {
  const chapters = [
    { start: 0, title: "Intro" },
    { start: 300, title: "Cells" },
    { start: 150, title: "History" },
    { start: 600, title: "Past the end" },
  ];

  it("places marks as percentages, sorted, without the opening chapter", () => {
    const marks = chapterMarkPositions(chapters, 600);
    expect(marks.map(mark => [mark.title, mark.percent])).toEqual([
      ["History", 25],
      ["Cells", 50],
    ]);
    expect(marks[0].label).toContain("History");
  });

  it("draws nothing until the length is known", () => {
    expect(chapterMarkPositions(chapters, 0)).toEqual([]);
    expect(chapterMarkPositions(chapters, Number.NaN)).toEqual([]);
    expect(chapterMarkPositions(null, 100)).toEqual([]);
  });
});
