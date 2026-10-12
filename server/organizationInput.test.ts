import { describe, expect, it } from "vitest";
import { isCourseColorKey, resolveCourseColor } from "../shared/courseColors";
import {
  courseInputSchema,
  courseUpdateSchema,
  diffTagIds,
  hasDuplicateName,
  keepOwnedIds,
  normalizeLabel,
  tagInputSchema,
} from "./organizationInput";
import { isMissingTableError } from "./bookmarks";

describe("normalizeLabel", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeLabel("  Intro   to \n Bio ")).toBe("Intro to Bio");
  });
});

describe("course and tag input", () => {
  it("normalises names and drops an empty term", () => {
    const parsed = courseInputSchema.parse({ name: "  BIO   101 ", term: "   " });
    expect(parsed).toEqual({ name: "BIO 101", term: undefined });
  });

  it("rejects blank or oversized names and unknown colours", () => {
    expect(courseInputSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(courseInputSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(courseInputSchema.safeParse({ name: "ok", color: "#ff0000" }).success).toBe(false);
    expect(tagInputSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(tagInputSchema.parse({ name: " exam ", color: "teal" })).toEqual({ name: "exam", color: "teal" });
  });

  it("lets an update clear the term with an empty string", () => {
    expect(courseUpdateSchema.parse({ id: 3, term: "" })).toEqual({ id: 3, term: "" });
  });
});

describe("hasDuplicateName", () => {
  const existing = [
    { id: 1, name: "Biology 101" },
    { id: 2, name: "Chemistry" },
  ];
  it("ignores case and spacing", () => {
    expect(hasDuplicateName(existing, "  biology   101 ")).toBe(true);
    expect(hasDuplicateName(existing, "Physics")).toBe(false);
  });
  it("lets an item keep its own name when renaming", () => {
    expect(hasDuplicateName(existing, "Chemistry", 2)).toBe(false);
    expect(hasDuplicateName(existing, "Chemistry", 1)).toBe(true);
  });
});

describe("keepOwnedIds", () => {
  it("drops ids the person does not own and repeats, keeping order", () => {
    expect(keepOwnedIds([5, 3, 5, 9, 1], [1, 3, 5])).toEqual([5, 3, 1]);
    expect(keepOwnedIds([], [1])).toEqual([]);
  });
});

describe("diffTagIds", () => {
  it("returns what to add and what to remove", () => {
    expect(diffTagIds([1, 2, 3], [2, 3, 4])).toEqual({ add: [4], remove: [1] });
    expect(diffTagIds([], [])).toEqual({ add: [], remove: [] });
  });
});

describe("course colours", () => {
  it("accepts known keys and falls back for legacy hex tag colours", () => {
    expect(isCourseColorKey("amber")).toBe(true);
    expect(isCourseColorKey("#3B82F6")).toBe(false);
    expect(resolveCourseColor("#3B82F6")).toBe("blue");
    expect(resolveCourseColor("rose")).toBe("rose");
    expect(resolveCourseColor(null)).toBe("blue");
  });
});

describe("isMissingTableError", () => {
  it("recognises a missing table however deep the driver wraps it", () => {
    expect(isMissingTableError({ code: "ER_NO_SUCH_TABLE" })).toBe(true);
    expect(isMissingTableError({ message: "Failed query", cause: { errno: 1146 } })).toBe(true);
    expect(isMissingTableError(new Error("connection reset"))).toBe(false);
  });
});
