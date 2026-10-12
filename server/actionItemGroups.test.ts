import { describe, expect, it } from "vitest";
import { addDays, daysBetween, describeDueDate, groupActionItems, isIsoDate } from "../shared/actionItems";

describe("dates", () => {
  it("accepts only real calendar days", () => {
    expect(isIsoDate("2026-10-12")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("12/10/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("counts days across month and year ends", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-12", "2026-10-10")).toBe(-2);
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("describes near dates in words", () => {
    expect(describeDueDate("2026-10-12", "2026-10-12")).toBe("Today");
    expect(describeDueDate("2026-10-13", "2026-10-12")).toBe("Tomorrow");
    expect(describeDueDate("2026-10-09", "2026-10-12")).toBe("3 days ago");
  });
});

describe("groupActionItems", () => {
  const today = "2026-10-12";
  const item = (id: number, dueDate: string | null, done = false) => ({ id, dueDate, done });

  it("buckets open items by due date and puts done items last", () => {
    const groups = groupActionItems(
      [item(1, "2026-10-20"), item(2, null), item(3, "2026-10-11"), item(4, "2026-10-12"), item(5, "2026-10-14"), item(6, "2026-10-13"), item(7, "2026-10-01", true)],
      today,
    );
    expect(groups.map(group => [group.id, group.items.map(entry => entry.id)])).toEqual([
      ["overdue", [3]],
      ["today", [4]],
      ["week", [6, 5]],
      ["later", [1]],
      ["undated", [2]],
      ["done", [7]],
    ]);
  });

  it("leaves out empty groups", () => {
    expect(groupActionItems([item(1, null)], today).map(group => group.id)).toEqual(["undated"]);
  });
});
