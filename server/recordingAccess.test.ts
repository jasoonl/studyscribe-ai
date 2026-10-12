import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

/**
 * A stand-in for the drizzle query builder: every chain resolves to the rows
 * configured for the table named in `.from(...)`, or rejects with the error
 * configured for it (to imitate a database that has not been migrated).
 */
const tables: Record<string, unknown[] | Error> = {};
const selectColumns: string[][] = [];

function query(columns: Record<string, unknown> | undefined) {
  let table = "";
  const builder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const result = tables[table] ?? [];
          const promise = result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
          return promise.then.bind(promise);
        }
        if (prop === "from") {
          return (source: any) => {
            table = getTableName(source);
            selectColumns.push(Object.keys(columns ?? {}));
            return builder;
          };
        }
        return () => builder;
      },
    },
  );
  return builder;
}

const fakeDb = { select: (columns?: Record<string, unknown>) => query(columns) };
const getRecordingById = vi.fn();

vi.mock("./db", () => ({
  getDb: async () => fakeDb,
  getRecordingById: (...args: unknown[]) => getRecordingById(...args),
}));

import { getRecordingAccess, requireRecordingAccess } from "./recordingAccess";

const RECORDING = { id: 10, userId: 1, isDeleted: 0, title: "Cells" };

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  selectColumns.length = 0;
  getRecordingById.mockResolvedValue(RECORDING);
});

describe("getRecordingAccess", () => {
  it("gives the owner the owner role", async () => {
    expect((await getRecordingAccess(10, 1))?.role).toBe("owner");
  });

  it("gives nobody access to a recording in the trash", async () => {
    getRecordingById.mockResolvedValue({ ...RECORDING, isDeleted: 1 });
    expect(await getRecordingAccess(10, 1)).toBeNull();
  });

  it("uses the direct share's role", async () => {
    tables.recordingShares = [{ id: 1, recordingId: 10, sharedWithUserId: 2, role: "comment" }];
    expect((await getRecordingAccess(10, 2))?.role).toBe("comment");
  });

  it("returns null for a stranger", async () => {
    expect(await getRecordingAccess(10, 3)).toBeNull();
  });

  it("takes the strongest of a direct share and a group share", async () => {
    tables.recordingShares = [{ id: 1, recordingId: 10, sharedWithUserId: 2, role: "view" }];
    tables.studyGroupMembers = [{ groupId: 5 }];
    tables.recordingCourses = [{ courseId: 7 }];
    tables.groupShares = [{ role: "edit" }];
    expect((await getRecordingAccess(10, 2))?.role).toBe("edit");
  });

  it("treats every share as view-only before the role column exists", async () => {
    let calls = 0;
    const unknownColumn = Object.assign(new Error("Unknown column 'role' in 'field list'"), { errno: 1054 });
    Object.defineProperty(tables, "recordingShares", {
      configurable: true,
      enumerable: true,
      get() {
        calls += 1;
        return calls === 1 ? unknownColumn : [{ id: 1, recordingId: 10, sharedWithUserId: 2 }];
      },
    });
    expect((await getRecordingAccess(10, 2))?.role).toBe("view");
    expect(selectColumns[0]).toContain("role");
    expect(selectColumns.find((columns, index) => index > 0 && columns.includes("sharedWithEmail"))).not.toContain("role");
  });

  it("ignores group tables that do not exist yet", async () => {
    tables.recordingShares = [{ id: 1, recordingId: 10, sharedWithUserId: 2, role: "comment" }];
    tables.studyGroupMembers = Object.assign(new Error("Table 'x.studyGroupMembers' doesn't exist"), { errno: 1146 });
    expect((await getRecordingAccess(10, 2))?.role).toBe("comment");
  });
});

describe("requireRecordingAccess", () => {
  it("reads as not found to someone with no access, so ids cannot be probed", async () => {
    await expect(requireRecordingAccess(10, 3, "view")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forbids a viewer from commenting and a commenter from editing", async () => {
    tables.recordingShares = [{ id: 1, recordingId: 10, sharedWithUserId: 2, role: "view" }];
    await expect(requireRecordingAccess(10, 2, "comment")).rejects.toMatchObject({ code: "FORBIDDEN" });
    tables.recordingShares = [{ id: 1, recordingId: 10, sharedWithUserId: 2, role: "comment" }];
    await expect(requireRecordingAccess(10, 2, "comment")).resolves.toMatchObject({ role: "comment" });
    await expect(requireRecordingAccess(10, 2, "edit")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an editor edit but keeps owner-only actions for the owner", async () => {
    tables.recordingShares = [{ id: 1, recordingId: 10, sharedWithUserId: 2, role: "edit" }];
    await expect(requireRecordingAccess(10, 2, "edit")).resolves.toMatchObject({ role: "edit" });
    await expect(requireRecordingAccess(10, 2, "owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireRecordingAccess(10, 1, "owner")).resolves.toMatchObject({ role: "owner" });
  });
});
