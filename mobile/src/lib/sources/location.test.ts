import { findQuote, formatLocation, parseLocation, sourceHref, unitFromPageParam } from "./location";

describe("parseLocation and formatLocation", () => {
  it("parses server labels", () => {
    expect(parseLocation("Page 4")).toEqual({ kind: "page", n: 4, title: null, continued: false });
    expect(parseLocation("Slide 7: Cell membrane")).toEqual({ kind: "slide", n: 7, title: "Cell membrane", continued: false });
    expect(parseLocation("Section 2: Cell biology (cont.)")?.continued).toBe(true);
    expect(parseLocation("Chapter nine")).toBeNull();
    expect(parseLocation(null)).toBeNull();
  });
  it("words them in English", () => {
    expect(formatLocation("Slide 7: Cell membrane")).toBe("Slide 7: Cell membrane");
    expect(formatLocation("page 4")).toBe("Page 4");
    expect(formatLocation("Section 2: Cell biology (cont.)")).toBe("Section 2: Cell biology (continued)");
    expect(formatLocation("Unknown label ")).toBe("Unknown label");
    expect(formatLocation(undefined)).toBe("");
  });
});

describe("sourceHref and unitFromPageParam", () => {
  it("round trips a 0-based unit through the 1-based address", () => {
    const href = sourceHref(12, { unitIndex: 3, quote: "the  cell\nmembrane" });
    expect(href).toBe("/sources/12?tab=pages&page=4&q=the+cell+membrane");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(unitFromPageParam(params.get("page"), 10)).toBe(3);
  });
  it("uses a tab when there is no unit, and caps the quote", () => {
    expect(sourceHref(5)).toBe("/sources/5");
    expect(sourceHref(5, { tab: "points" })).toBe("/sources/5?tab=points");
    const long = sourceHref(5, { unitIndex: 0, quote: "x".repeat(300) });
    expect(new URLSearchParams(long.split("?")[1]).get("q")).toHaveLength(120);
  });
  it("rejects bad page values", () => {
    expect(unitFromPageParam("0", 5)).toBeNull();
    expect(unitFromPageParam("6", 5)).toBeNull();
    expect(unitFromPageParam("2x", 5)).toBeNull();
    expect(unitFromPageParam(null, 5)).toBeNull();
  });
});

describe("findQuote", () => {
  it("ignores case and whitespace runs and maps back to the original text", () => {
    const text = "Intro.\n\nThe   Cell\nMembrane controls transport.";
    const range = findQuote(text, "the cell membrane");
    expect(range).not.toBeNull();
    expect(text.slice(range![0], range![1])).toBe("The   Cell\nMembrane");
  });
  it("returns null when absent or empty", () => {
    expect(findQuote("abc", "xyz")).toBeNull();
    expect(findQuote("abc", "  ")).toBeNull();
    expect(findQuote("abc", null)).toBeNull();
  });
});
