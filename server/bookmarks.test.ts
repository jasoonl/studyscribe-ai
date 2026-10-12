import { describe, expect, it } from "vitest";
import { bookmarkInputSchema, isMissingTableError } from "./bookmarks";

describe("isMissingTableError", () => {
  it("recognises MySQL's missing-table error, including when a driver wraps it", () => {
    expect(isMissingTableError({ code: "ER_NO_SUCH_TABLE" })).toBe(true);
    expect(isMissingTableError(new Error("Failed query", { cause: { errno: 1146 } }))).toBe(true);
    expect(isMissingTableError(new Error("Table 'test.recordingBookmarks' doesn't exist"))).toBe(true);
  });

  it("does not hide other database errors", () => {
    expect(isMissingTableError(new Error("Connection lost"))).toBe(false);
    expect(isMissingTableError({ code: "ER_DUP_ENTRY" })).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});

describe("bookmarkInputSchema", () => {
  it("accepts a time and trims the label", () => {
    expect(bookmarkInputSchema.parse({ atSeconds: 12.4, label: "  exam hint " })).toEqual({ atSeconds: 12.4, label: "exam hint" });
  });

  it("rejects negative times and long labels", () => {
    expect(() => bookmarkInputSchema.parse({ atSeconds: -1 })).toThrow();
    expect(() => bookmarkInputSchema.parse({ atSeconds: 1, label: "x".repeat(121) })).toThrow();
  });
});
