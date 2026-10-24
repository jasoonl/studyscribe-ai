import { describe, expect, it } from "vitest";
import { askHref, askRequestOptions, citationLink, parseAskSources, pickerLabel, quoteFromSnippet } from "./askSources";

describe("parseAskSources", () => {
  it("reads ids and mode", () => {
    expect(parseAskSources("?course=3&source=4,5&mode=sources")).toEqual({ ids: [4, 5], mode: "sources" });
  });
  it("ignores bad ids, duplicates and unknown modes", () => {
    expect(parseAskSources("source=4,x,4,-1,0,7&mode=weird")).toEqual({ ids: [4, 7], mode: "both" });
    expect(parseAskSources("")).toEqual({ ids: [], mode: "both" });
  });
});

describe("askHref", () => {
  it("leaves defaults out and keeps the course", () => {
    expect(askHref(undefined, { ids: [], mode: "both" })).toBe("/ask");
    expect(askHref(3, { ids: [4, 5], mode: "both" })).toBe("/ask?course=3&source=4%2C5");
    expect(askHref(3, { ids: [4], mode: "recordings" })).toBe("/ask?course=3&mode=recordings");
    expect(askHref(3, { ids: [], mode: "sources" })).toBe("/ask?course=3&mode=sources");
  });
  it("round trips through parse", () => {
    const selection = { ids: [2, 9], mode: "sources" as const };
    expect(parseAskSources(askHref(1, selection).split("?")[1])).toEqual(selection);
  });
});

describe("askRequestOptions", () => {
  it("maps the mode and selection onto the request", () => {
    expect(askRequestOptions({ ids: [], mode: "both" })).toEqual({ includeSources: true, includeRecordings: true });
    expect(askRequestOptions({ ids: [4], mode: "sources" })).toEqual({ includeSources: true, includeRecordings: false, sourceIds: [4] });
    expect(askRequestOptions({ ids: [4], mode: "recordings" })).toEqual({ includeSources: false, includeRecordings: true });
  });
});

describe("pickerLabel", () => {
  it("names the choice", () => {
    expect(pickerLabel({ ids: [], mode: "both" }, 5)).toEqual({ key: "all", count: 5 });
    expect(pickerLabel({ ids: [1, 2, 3], mode: "both" }, 5)).toEqual({ key: "some", count: 3 });
    expect(pickerLabel({ ids: [1], mode: "recordings" }, 5)).toEqual({ key: "recordingsOnly", count: 0 });
    expect(pickerLabel({ ids: [], mode: "both" }, 0)).toEqual({ key: "none", count: 0 });
  });
});

describe("quoteFromSnippet and citationLink", () => {
  it("trims ellipses and cuts long text at a word", () => {
    expect(quoteFromSnippet("…the cell membrane is selective…")).toBe("the cell membrane is selective");
    const long = "word ".repeat(40);
    const quote = quoteFromSnippet(long);
    expect(quote.length).toBeLessThanOrEqual(80);
    expect(quote.endsWith("word")).toBe(true);
  });
  it("links a source citation to its page and a recording citation to its moment", () => {
    expect(citationLink({ n: 1, recordingId: 0, title: "Notes", start: null, snippet: "Osmosis moves water", sourceId: 8, location: "Slide 7", unitIndex: 6 })).toBe(
      "/sources/8?tab=pages&page=7&q=Osmosis+moves+water",
    );
    expect(citationLink({ n: 2, recordingId: 5, title: "Lecture", start: 61.9, snippet: "x" })).toBe("/recording/5?t=61");
    expect(citationLink({ n: 3, recordingId: 5, title: "Lecture", start: null, snippet: "x" })).toBe("/recording/5");
  });
  it("opens the source without a page when the unit is unknown", () => {
    expect(citationLink({ n: 1, recordingId: 0, title: "N", start: null, snippet: "x", sourceId: 2 })).toBe("/sources/2");
  });
});
