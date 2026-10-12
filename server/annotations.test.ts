import { describe, expect, it } from "vitest";
import { buildThreads, canDelete, canResolve, splitIntoRuns, validateAnchor } from "@shared/annotations";
import { canSeeAnnotations, roleAllows, strongestRole } from "@shared/sharing";

const segments = [
  { id: "s0", text: "Welcome to the course." },
  { id: "s1", text: "Mitochondria are the powerhouse of the cell." },
];

describe("share roles", () => {
  it("orders view < comment < edit < owner", () => {
    expect(roleAllows("view", "view")).toBe(true);
    expect(roleAllows("view", "comment")).toBe(false);
    expect(roleAllows("comment", "comment")).toBe(true);
    expect(roleAllows("comment", "edit")).toBe(false);
    expect(roleAllows("edit", "comment")).toBe(true);
    expect(roleAllows("edit", "owner")).toBe(false);
    expect(roleAllows("owner", "edit")).toBe(true);
    expect(roleAllows(null, "view")).toBe(false);
  });

  it("takes the strongest of overlapping grants (direct share and groups)", () => {
    expect(strongestRole(["view", null, "edit", "comment"])).toBe("edit");
    expect(strongestRole([null, undefined])).toBeNull();
  });

  it("hides comments from view-only recipients", () => {
    expect(canSeeAnnotations("view")).toBe(false);
    expect(canSeeAnnotations("comment")).toBe(true);
    expect(canSeeAnnotations("owner")).toBe(true);
  });
});

describe("validateAnchor", () => {
  it("accepts a selection inside one line and takes the quote from the transcript", () => {
    const result = validateAnchor(segments, { segmentIndex: 1, segmentId: "s1", startOffset: 0, endOffset: 12, quote: "Mitochondria" });
    expect(result).toEqual({ ok: true, anchor: { segmentIndex: 1, segmentId: "s1", startOffset: 0, endOffset: 12, quote: "Mitochondria" } });
  });

  it("tolerates whitespace differences in the quote", () => {
    const result = validateAnchor(segments, { segmentIndex: 1, startOffset: 17, endOffset: 31, quote: "the  powerhouse" });
    expect(result.ok).toBe(true);
  });

  it("rejects missing lines, changed lines, empty or out-of-range selections and wrong quotes", () => {
    expect(validateAnchor(segments, { segmentIndex: 5, startOffset: 0, endOffset: 2, quote: "We" }).ok).toBe(false);
    expect(validateAnchor(segments, { segmentIndex: 1, segmentId: "other", startOffset: 0, endOffset: 12, quote: "Mitochondria" }).ok).toBe(false);
    expect(validateAnchor(segments, { segmentIndex: 0, startOffset: 3, endOffset: 3, quote: "" }).ok).toBe(false);
    expect(validateAnchor(segments, { segmentIndex: 0, startOffset: 0, endOffset: 999, quote: "Welcome" }).ok).toBe(false);
    expect(validateAnchor(segments, { segmentIndex: 0, startOffset: 0, endOffset: 7, quote: "Goodbye" }).ok).toBe(false);
    expect(validateAnchor(null, { segmentIndex: 0, startOffset: 0, endOffset: 7, quote: "Welcome" }).ok).toBe(false);
  });
});

describe("moderation rules", () => {
  it("lets the thread author, editors and the owner resolve; not other commenters", () => {
    expect(canResolve({ userId: 2, role: "comment" }, 2)).toBe(true);
    expect(canResolve({ userId: 3, role: "comment" }, 2)).toBe(false);
    expect(canResolve({ userId: 3, role: "edit" }, 2)).toBe(true);
    expect(canResolve({ userId: 1, role: "owner" }, 2)).toBe(true);
  });

  it("lets authors delete their own and the owner delete anything", () => {
    expect(canDelete({ userId: 2, role: "comment" }, 2)).toBe(true);
    expect(canDelete({ userId: 3, role: "edit" }, 2)).toBe(false);
    expect(canDelete({ userId: 1, role: "owner" }, 2)).toBe(true);
  });
});

describe("buildThreads", () => {
  it("nests replies under their root in time order and drops orphans", () => {
    const rows = [
      { id: 3, parentId: 1, createdAt: "2026-01-01T10:05:00Z" },
      { id: 1, parentId: null, createdAt: "2026-01-01T10:00:00Z" },
      { id: 2, parentId: 1, createdAt: "2026-01-01T10:01:00Z" },
      { id: 4, parentId: null, createdAt: "2026-01-01T09:00:00Z" },
      { id: 5, parentId: 99, createdAt: "2026-01-01T09:00:00Z" },
    ];
    const threads = buildThreads(rows);
    expect(threads.map(thread => thread.id)).toEqual([4, 1]);
    expect(threads[1].replies.map(reply => reply.id)).toEqual([2, 3]);
  });
});

describe("splitIntoRuns", () => {
  it("splits text so overlapping highlights never nest", () => {
    expect(
      splitIntoRuns(10, [
        { id: 1, start: 2, end: 6 },
        { id: 2, start: 4, end: 8 },
      ]),
    ).toEqual([
      { start: 0, end: 2, ids: [] },
      { start: 2, end: 4, ids: [1] },
      { start: 4, end: 6, ids: [1, 2] },
      { start: 6, end: 8, ids: [2] },
      { start: 8, end: 10, ids: [] },
    ]);
  });

  it("clamps ranges to the text", () => {
    expect(splitIntoRuns(4, [{ id: 1, start: -3, end: 50 }])).toEqual([{ start: 0, end: 4, ids: [1] }]);
  });
});
