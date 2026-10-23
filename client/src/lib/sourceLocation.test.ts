import { describe, expect, it } from "vitest";
import { findQuote, formatLocation, parseLocation, sourceHref, unitFromPageParam, type LocationKey } from "./sourceLocation";

const words: Record<LocationKey, string> = {
  "sources.location.page": "Page {n}",
  "sources.location.slide": "Slide {n}",
  "sources.location.section": "Section {n}",
  "sources.location.cont": "(cont.)",
};
const t = (key: LocationKey, vars?: Record<string, string | number>) => words[key].replace("{n}", String(vars?.n ?? ""));
const spanish = (key: LocationKey, vars?: Record<string, string | number>) =>
  ({ ...words, "sources.location.slide": "Diapositiva {n}", "sources.location.cont": "(cont.)" })[key].replace("{n}", String(vars?.n ?? ""));

describe("parseLocation", () => {
  it("reads pages, slides and sections", () => {
    expect(parseLocation("Page 12")).toEqual({ kind: "page", n: 12, title: null, continued: false });
    expect(parseLocation("Slide 7: Cell membrane")).toEqual({ kind: "slide", n: 7, title: "Cell membrane", continued: false });
    expect(parseLocation("Section 2: Methods (cont.)")).toMatchObject({ kind: "section", n: 2, continued: true });
    expect(parseLocation("Page 4 (cont.)")).toMatchObject({ kind: "page", n: 4, title: null, continued: true });
  });
  it("returns null for anything else", () => {
    expect(parseLocation("Chapter one")).toBeNull();
    expect(parseLocation("")).toBeNull();
    expect(parseLocation(null)).toBeNull();
  });
});

describe("formatLocation", () => {
  it("words the label in the interface language and keeps the title", () => {
    expect(formatLocation("Slide 7", t)).toBe("Slide 7");
    expect(formatLocation("Slide 7: Osmosis", spanish)).toBe("Diapositiva 7: Osmosis");
    expect(formatLocation("Page 4 (cont.)", t)).toBe("Page 4 (cont.)");
    expect(formatLocation("Section 3: Results (cont.)", t)).toBe("Section 3: Results (cont.)");
  });
  it("shows an unknown label as written", () => {
    expect(formatLocation("  Appendix ", t)).toBe("Appendix");
    expect(formatLocation(undefined, t)).toBe("");
  });
});

describe("sourceHref", () => {
  it("opens the library entry with no unit", () => {
    expect(sourceHref(5)).toBe("/sources/5");
    expect(sourceHref(5, { tab: "points" })).toBe("/sources/5?tab=points");
  });
  it("turns a 0-based unit into a 1-based page and keeps a short quote", () => {
    expect(sourceHref(5, { unitIndex: 0 })).toBe("/sources/5?tab=pages&page=1");
    expect(sourceHref(5, { unitIndex: 6, quote: "  the  membrane\nis selective " })).toBe("/sources/5?tab=pages&page=7&q=the+membrane+is+selective");
  });
  it("ignores an invalid unit", () => {
    expect(sourceHref(5, { unitIndex: -1 })).toBe("/sources/5");
    expect(sourceHref(5, { unitIndex: 1.5 })).toBe("/sources/5");
  });
  it("drops the quote when there is no page", () => {
    expect(sourceHref(5, { quote: "hello" })).toBe("/sources/5");
  });
});

describe("unitFromPageParam", () => {
  it("maps a page number to a unit index inside the source", () => {
    expect(unitFromPageParam("1", 10)).toBe(0);
    expect(unitFromPageParam("10", 10)).toBe(9);
    expect(unitFromPageParam("11", 10)).toBeNull();
    expect(unitFromPageParam("0", 10)).toBeNull();
    expect(unitFromPageParam("abc", 10)).toBeNull();
    expect(unitFromPageParam(null, 10)).toBeNull();
  });
});

describe("findQuote", () => {
  it("finds a quote across line breaks, ignoring case", () => {
    const text = "Intro.\nThe cell   membrane\nis selectively permeable.";
    const range = findQuote(text, "cell membrane is selectively");
    expect(range).not.toBeNull();
    expect(text.slice(range![0], range![1]).replace(/\s+/g, " ")).toBe("cell membrane is selectively");
  });
  it("returns null when absent or empty", () => {
    expect(findQuote("abc", "xyz")).toBeNull();
    expect(findQuote("abc", "")).toBeNull();
    expect(findQuote("abc", null)).toBeNull();
  });
});
