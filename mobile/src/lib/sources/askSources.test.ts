import { askRequestOptions, citationLink, emptySelection, pickerLabel, quoteFromSnippet } from "./askSources";

describe("askRequestOptions", () => {
  it("searches both by default and sends no ids", () => {
    expect(askRequestOptions(emptySelection)).toEqual({ includeSources: true, includeRecordings: true });
  });
  it("sources only", () => {
    expect(askRequestOptions({ ids: [3, 4], mode: "sources" })).toEqual({ includeSources: true, includeRecordings: false, sourceIds: [3, 4] });
  });
  it("recordings only ignores ids", () => {
    expect(askRequestOptions({ ids: [3], mode: "recordings" })).toEqual({ includeSources: false, includeRecordings: true });
  });
  it("both with chosen ids", () => {
    expect(askRequestOptions({ ids: [9], mode: "both" })).toEqual({ includeSources: true, includeRecordings: true, sourceIds: [9] });
  });
});

describe("pickerLabel", () => {
  it("names the selection", () => {
    expect(pickerLabel(emptySelection, 3)).toEqual({ key: "all", count: 3 });
    expect(pickerLabel({ ids: [1, 2], mode: "both" }, 3)).toEqual({ key: "some", count: 2 });
    expect(pickerLabel({ ids: [], mode: "recordings" }, 3)).toEqual({ key: "recordingsOnly", count: 0 });
    expect(pickerLabel(emptySelection, 0)).toEqual({ key: "none", count: 0 });
  });
});

describe("citationLink", () => {
  it("opens a source at its page with a short quote", () => {
    const href = citationLink({ n: 1, recordingId: 0, title: "Bio", start: null, snippet: "... Osmosis moves water across a membrane ...", sourceId: 7, unitIndex: 2 });
    expect(href.startsWith("/sources/7?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("tab")).toBe("pages");
    expect(params.get("page")).toBe("3");
    expect(params.get("q")).toBe("Osmosis moves water across a membrane");
  });
  it("leaves recording citations unchanged", () => {
    expect(citationLink({ n: 1, recordingId: 5, title: "Lecture", start: 61.9, snippet: "x" })).toBe("/recording/5?t=61");
    expect(citationLink({ n: 1, recordingId: 5, title: "Lecture", start: null, snippet: "x" })).toBe("/recording/5");
  });
});

describe("quoteFromSnippet", () => {
  it("cuts long snippets at a word", () => {
    const quote = quoteFromSnippet("word ".repeat(40));
    expect(quote.length).toBeLessThanOrEqual(80);
    expect(quote.endsWith("word")).toBe(true);
  });
});
