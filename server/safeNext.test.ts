import { describe, expect, it } from "vitest";
import { nextFromLocation, safeNextPath } from "@shared/safeNext";

describe("safeNextPath", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNextPath("/groups/join/abc123")).toBe("/groups/join/abc123");
    expect(safeNextPath("/recording/12?t=754")).toBe("/recording/12?t=754");
  });

  it("refuses other sites, however they are spelled", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\u0000x",
      "/a\\b",
      "evil.example",
      "javascript:alert(1)",
      "",
      `/${"a".repeat(400)}`,
    ]) {
      expect(safeNextPath(value), JSON.stringify(value)).toBeNull();
    }
    expect(safeNextPath(42)).toBeNull();
  });

  it("never lands on an API endpoint", () => {
    expect(safeNextPath("/api/auth/logout")).toBeNull();
    expect(safeNextPath("/API/auth/logout")).toBeNull();
    expect(safeNextPath("/api")).toBeNull();
    expect(safeNextPath("/apiary")).toBe("/apiary");
  });
});

describe("nextFromLocation", () => {
  it("returns the protected page to come back to", () => {
    expect(nextFromLocation("/groups/join/abc", "")).toBe("/groups/join/abc");
    expect(nextFromLocation("/recording/5", "?t=30")).toBe("/recording/5?t=30");
  });

  it("skips pages that need no return trip", () => {
    expect(nextFromLocation("/dashboard")).toBeNull();
    expect(nextFromLocation("/login", "?next=/x")).toBeNull();
  });
});
