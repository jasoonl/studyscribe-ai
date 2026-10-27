import { drizzle } from "drizzle-orm/mysql2";
import { like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { studySourceUnits } from "../drizzle/schema";
import { buildSimpleUnitsQuery, buildWindowedUnitsQuery } from "./ask";

// Builds the SQL only; the fake client is never used because nothing is executed.
const db = drizzle({ client: {} as never });
const args = { userId: 7, termMatches: [like(studySourceUnits.text, "%atp%")], courseId: 3, sourceIds: [4, 5], perSource: 8 };

describe("source units SQL", () => {
  it("numbers units per source in a subquery and filters on that number", () => {
    const { sql, params } = buildWindowedUnitsQuery(db as never, args).toSQL();
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY `studySources`\.`id` ORDER BY `studySourceUnits`\.`unitIndex`\)/i);
    expect(sql).toMatch(/\) `ranked`/);
    expect(sql).toMatch(/\) `ranked` where `rn` <= \?/);
    expect(sql).toMatch(/`studySources`\.`userId` = \?/);
    expect(sql).toMatch(/`studySourceUnits`\.`userId` = \?/);
    // Inner filters first (both owners, statuses, course, source ids, term), then the cap, then the limit.
    expect(params).toEqual([7, 7, "extracted", "analyzing", "ready", 3, 4, 5, "%atp%", 8, 200]);
  });

  it("keeps the owner filters in the simple fallback too", () => {
    const { sql, params } = buildSimpleUnitsQuery(db as never, args).toSQL();
    expect(sql).not.toMatch(/ROW_NUMBER/i);
    expect(sql).toMatch(/`studySources`\.`userId` = \?/);
    expect(params.slice(0, 2)).toEqual([7, 7]);
    expect(params[params.length - 1]).toBe(200);
  });
});
