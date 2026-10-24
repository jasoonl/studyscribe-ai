import { TRPCClientError } from "@trpc/client";
import { errorMessage } from "@/lib/trpc";
import {
  USAGE_LIMIT_SENTENCE,
  formatSize,
  isSourceStalled,
  lineIndexAt,
  pruneSelection,
  pagesTabLabel,
  parseDetailParams,
  revealKey,
  searchedLine,
  sourceCitationLabel,
  sourceErrorText,
  unitCountText,
} from "./detailModel";

function trpcError(message: string, data: Record<string, unknown>) {
  const error = new TRPCClientError(message);
  (error as { data: unknown }).data = data;
  return error;
}

describe("parseDetailParams", () => {
  it("defaults to the summary", () => {
    expect(parseDetailParams({}, 5)).toEqual({ tab: "summary", unit: null, quote: null });
  });
  it("a page opens Pages and keeps the quote", () => {
    expect(parseDetailParams({ tab: "summary", page: "3", q: "  osmosis   moves " }, 5)).toEqual({ tab: "pages", unit: 2, quote: "osmosis moves" });
  });
  it("ignores a quote without a valid page and bad values", () => {
    expect(parseDetailParams({ tab: "pages", page: "9", q: "x" }, 5)).toEqual({ tab: "pages", unit: null, quote: null });
    expect(parseDetailParams({ tab: "nope", page: "abc" }, 5).tab).toBe("summary");
    expect(parseDetailParams({ tab: "points" }, 5).tab).toBe("points");
  });
  it("caps the quote and takes the first of repeated params", () => {
    expect(parseDetailParams({ page: ["2", "3"], q: "a".repeat(300) }, 5).quote).toHaveLength(120);
    expect(parseDetailParams({ page: ["2", "3"] }, 5).unit).toBe(1);
  });
});

describe("revealKey", () => {
  it("is stable for the same source, page and quote", () => {
    expect(revealKey(1, 2, "q")).toBe(revealKey(1, 2, "q"));
    expect(revealKey(1, 2, "q")).not.toBe(revealKey(1, 3, "q"));
    expect(revealKey(1, 2, null)).toBe("1:2:");
  });
});

describe("labels", () => {
  it("names tabs and counts by kind", () => {
    expect(pagesTabLabel("pptx")).toBe("Slides");
    expect(pagesTabLabel("pdf")).toBe("Pages");
    expect(pagesTabLabel("docx")).toBe("Sections");
    expect(unitCountText("pptx", 1)).toBe("1 slide");
    expect(unitCountText("pdf", 12)).toBe("12 pages");
  });
  it("formats sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatSize(20 * 1024 * 1024)).toBe("20 MB");
  });
});

describe("lineIndexAt", () => {
  it("finds the line holding an offset", () => {
    const lines = [{ text: "hello " }, { text: "world " }, { text: "again" }];
    expect(lineIndexAt(lines, 0)).toBe(0);
    expect(lineIndexAt(lines, 6)).toBe(1);
    expect(lineIndexAt(lines, 13, 17)).toBe(2);
    expect(lineIndexAt(lines, 999)).toBe(2);
    expect(lineIndexAt([], 3)).toBeNull();
  });
  it("gives up when line texts omit hard line breaks", () => {
    const text = "first\nsecond";
    const lines = [{ text: "first" }, { text: "second" }];
    expect(lineIndexAt(lines, 8, text.length)).toBeNull();
    expect(lineIndexAt([{ text: "first\n" }, { text: "second" }], 8, text.length)).toBe(1);
  });
});

describe("pruneSelection", () => {
  it("drops ids that are no longer ready sources", () => {
    expect(pruneSelection({ ids: [1, 2, 3], mode: "both" }, [1, 3])).toEqual({ ids: [1, 3], mode: "both" });
  });
  it("keeps the same object when nothing changed and when all are selected", () => {
    const same = { ids: [1], mode: "sources" as const };
    expect(pruneSelection(same, [1, 2])).toBe(same);
    const all = { ids: [], mode: "both" as const };
    expect(pruneSelection(all, [])).toBe(all);
  });
  it("falls back to an empty list (all sources) when every chosen source is gone", () => {
    expect(pruneSelection({ ids: [5], mode: "both" }, [1])).toEqual({ ids: [], mode: "both" });
  });
});

describe("isSourceStalled", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("only for work with no news for two minutes", () => {
    expect(isSourceStalled({ status: "analyzing", updatedAt: "2026-01-01T11:55:00Z" }, now)).toBe(true);
    expect(isSourceStalled({ status: "analyzing", updatedAt: "2026-01-01T11:59:30Z" }, now)).toBe(false);
    expect(isSourceStalled({ status: "ready", updatedAt: "2026-01-01T11:00:00Z" }, now)).toBe(false);
    expect(isSourceStalled({ status: "failed", updatedAt: "2026-01-01T11:00:00Z" }, now)).toBe(false);
  });
});

describe("sourceErrorText", () => {
  it("states a usage limit plainly, with no plan wording", () => {
    const text = sourceErrorText(trpcError("x", { usageLimit: { kind: "ai", upgradeAvailable: true } }));
    expect(text).toBe(USAGE_LIMIT_SENTENCE);
    expect(text).not.toMatch(/plan|upgrade|price|\$/i);
  });
  it("errorMessage from trpc.ts never shows server plan wording for a usage limit", () => {
    const server = trpcError("You have used this month's AI allowance. Billing has plans with more.", { code: "FORBIDDEN", usageLimit: { kind: "ai", upgradeAvailable: true } });
    const text = errorMessage(server);
    expect(text).toBe(USAGE_LIMIT_SENTENCE);
    expect(text).not.toMatch(/plan|billing|upgrade|price|subscribe/i);
  });
  it("maps rate limits and network failures", () => {
    expect(sourceErrorText(trpcError("x", { code: "TOO_MANY_REQUESTS" }))).toMatch(/little fast/);
    expect(sourceErrorText(new TRPCClientError("Failed to fetch"))).toMatch(/Can't reach/);
    expect(sourceErrorText(trpcError("Only a file that failed can be retried.", { code: "BAD_REQUEST" }))).toBe("Only a file that failed can be retried.");
    expect(sourceErrorText(undefined)).toMatch(/Something went wrong/);
  });
});

describe("Ask helpers", () => {
  it("adds a source line only when sources were searched", () => {
    expect(searchedLine({ askedSources: false, searched: 2 })).toBeNull();
    expect(searchedLine({ askedSources: true, searched: 2 })).toBeNull();
    expect(searchedLine({ askedSources: true, searched: 2, searchedSources: 1 })).toBe("Searched 1 source and 2 recordings.");
    expect(searchedLine({ askedSources: true, searched: 0, searchedSources: 0 })).toBe("Nothing in your sources or recordings matched.");
  });
  it("labels a citation", () => {
    expect(sourceCitationLabel(2, "Bio", "Slide 7: Cells")).toBe("Source 2: Bio, Slide 7: Cells");
    expect(sourceCitationLabel(2, "Bio", "")).toBe("Source 2: Bio");
  });
});
