import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NOTE_BODY_CHARS, MAX_NOTE_PAGES_PER_USER } from "@shared/notePages";

let script: Record<string, any[]> = {};
let failures: Record<string, unknown> = {};
const inserted: any[] = [];
const sets: any[] = [];
const log: string[] = [];
const selectedFields: any[] = [];

function chain(key: string): any {
  const proxy: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          if (failures[key]) return reject(failures[key]);
          const queue = script[key];
          resolve(queue && queue.length ? queue.shift() : key.endsWith(":select") ? [] : [{ insertId: 9, affectedRows: 1 }]);
        };
      }
      if (prop === "values") return (values: any) => (inserted.push(values), proxy);
      if (prop === "set") return (values: any) => (sets.push(values), proxy);
      return () => proxy;
    },
  });
  return proxy;
}
const op = (name: string) => (table: any) => {
  const key = `${getTableName(table)}:${name}`;
  log.push(key);
  return chain(key);
};
const fakeDb: any = { select: (fields?: any) => (selectedFields.push(fields), { from: op("select") }), insert: op("insert"), update: op("update"), delete: op("delete") };
vi.mock("./db", () => ({ getDb: async () => fakeDb }));
const llm = vi.hoisted(() => ({ completeText: vi.fn(), completeJson: vi.fn() }));
vi.mock("./llmJson", () => llm);
const courses = vi.hoisted(() => ({ getOwnCourse: vi.fn() }));
vi.mock("./courses", () => courses);
vi.mock("./usage", async () => {
  const { protectedProcedure } = await import("./_core/trpc");
  return { aiProcedure: protectedProcedure };
});

const { nextStamp, notePagesRouter, deleteNotePagesForUser, exportNotePagesForUser, detachNotesFromCourse, summarizeNote } = await import("./notePages");

let nextUser = 100;
const caller = () => notePagesRouter.createCaller({ req: {} as any, res: {} as any, user: { id: nextUser, role: "user", email: "a@example.com" } as any });
const now = new Date("2026-10-24T12:00:00Z");
const row = (extra: Record<string, unknown> = {}) => ({ id: 1, userId: nextUser, preview: "Mitosis has four phases", title: "Bio", body: "Mitosis has four phases and a long explanation.", courseId: null, createdAt: now, updatedAt: now, ...extra });
const missingTable = { code: "ER_NO_SUCH_TABLE", message: "Table 'x.notePages' doesn't exist" };

beforeEach(() => {
  nextUser += 1;
  script = {};
  failures = {};
  inserted.length = 0;
  sets.length = 0;
  log.length = 0;
  selectedFields.length = 0;
  vi.clearAllMocks();
  courses.getOwnCourse.mockResolvedValue({ id: 5, archived: false });
});

describe("ownership", () => {
  it("answers NOT_FOUND when the note is missing or belongs to someone else", async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => caller().get({ id: 1 }),
      () => caller().update({ id: 1, title: "x" }),
      () => caller().delete({ id: 1 }),
      () => caller().organize({ id: 1, mode: "tidy" }),
    ];
    for (const call of calls) {
      script = { "notePages:select": [[]] };
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
      script = { "notePages:select": [[row({ userId: 999 })]] };
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(sets).toHaveLength(0);
    expect(llm.completeText).not.toHaveBeenCalled();
    expect(log).not.toContain("notePages:delete");
  });

  it("never lists rows of another user even if the query returned them", async () => {
    script = { "notePages:select": [[row({ id: 1 }), row({ id: 2, userId: 999 })]] };
    const result = await caller().list();
    expect(result.notes.map(note => note.id)).toEqual([1]);
  });

  it("refuses a course that is not the person's own, on create and update", async () => {
    courses.getOwnCourse.mockResolvedValue(null);
    await expect(caller().create({ courseId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Course not found" });
    script = { "notePages:select": [[row()]] };
    await expect(caller().update({ id: 1, courseId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(inserted).toHaveLength(0);
    expect(sets).toHaveLength(0);
  });

  it("refuses an archived course for a new filing but allows saving text on a note already in one", async () => {
    courses.getOwnCourse.mockResolvedValue({ id: 5, archived: true });
    await expect(caller().create({ courseId: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    script = { "notePages:select": [[row({ courseId: 5 })]] };
    await expect(caller().update({ id: 1, body: "more text" })).resolves.toMatchObject({ id: 1 });
    expect(sets).toEqual([{ body: "more text", updatedAt: expect.any(Date) }]);
  });
});

describe("caps and input", () => {
  it("rejects a body over the cap and trims titles", async () => {
    await expect(caller().create({ body: "a".repeat(MAX_NOTE_BODY_CHARS + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    script = { "notePages:select": [[{ count: "0" }]] };
    await caller().create({ title: "  Week   1  ", body: "hello" });
    expect(inserted[0]).toMatchObject({ userId: nextUser, title: "Week 1", body: "hello", courseId: null });
  });

  it("stops at the per-person maximum", async () => {
    script = { "notePages:select": [[{ count: String(MAX_NOTE_PAGES_PER_USER) }]] };
    await expect(caller().create({ title: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(inserted).toHaveLength(0);
  });

  it("rate limits writes", async () => {
    script = { "notePages:select": Array.from({ length: 300 }, () => [row()]) };
    let refused = false;
    for (let i = 0; i < 300 && !refused; i++) {
      try { await caller().update({ id: 1, body: "x" }); } catch (error: any) { refused = error.code === "TOO_MANY_REQUESTS"; }
    }
    expect(refused).toBe(true);
  });
});

describe("missing table (migration 0036 not applied)", () => {
  it("lists nothing and says it is unavailable", async () => {
    failures = { "notePages:select": missingTable };
    await expect(caller().list()).resolves.toEqual({ available: false, notes: [] });
    await expect(caller().get({ id: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteNotePagesForUser(1)).resolves.toBeUndefined();
    await expect(exportNotePagesForUser(1)).resolves.toEqual([]);
  });

  it("explains itself on writes", async () => {
    failures = { "notePages:select": missingTable };
    await expect(caller().create({ title: "x" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Notes are not set up on this server yet." });
    failures = { "notePages:insert": missingTable };
    script = { "notePages:select": [[{ count: "0" }]] };
    await expect(caller().create({ title: "x" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("organize", () => {
  it("returns Markdown for a preview and saves nothing", async () => {
    script = { "notePages:select": [[row()]] };
    llm.completeText.mockResolvedValue("```markdown\n# Bio\n- Mitosis\n```");
    const result = await caller().organize({ id: 1, mode: "tidy" });
    expect(result).toEqual({ mode: "tidy", markdown: "# Bio\n- Mitosis", shortened: false });
    const call = llm.completeText.mock.calls[0][0];
    expect(call.maxTokens).toBeGreaterThan(0);
    expect(call.timeoutMs).toBeLessThan(50_000);
    expect(sets).toHaveLength(0);
    expect(log).not.toContain("notePages:update");
  });

  it("asks for more text when the note is nearly empty", async () => {
    script = { "notePages:select": [[row({ body: "hi" })]] };
    await expect(caller().organize({ id: 1, mode: "summary" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(llm.completeText).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    await expect(caller().organize({ id: 1, mode: "rewrite" as any })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("lifecycle helpers", () => {
  it("exports without the owner id and unfiles notes of a removed course", async () => {
    script = { "notePages:select": [[row()]] };
    const [exported] = await exportNotePagesForUser(nextUser);
    expect(exported).not.toHaveProperty("userId");
    await detachNotesFromCourse(nextUser, 5);
    expect(sets).toEqual([{ courseId: null }]);
    expect(log).toContain("notePages:update");
  });

  it("previews without Markdown symbols", () => {
    expect(summarizeNote(row({ preview: "# Title\n\n- **bold** item" })).preview).toBe("Title bold item");
  });
});

describe("list preview", () => {
  it("asks the database for a short computed preview, never the whole body", async () => {
    script = { "notePages:select": [[row()]] };
    await caller().list();
    const fields = selectedFields[0];
    expect(Object.keys(fields)).toContain("preview");
    expect(Object.keys(fields)).not.toContain("body");
    expect(fields.preview.queryChunks.map((chunk: any) => chunk?.value ?? []).flat().join("")).toContain("SUBSTRING");
  });
});

describe("concurrent edits", () => {
  const base = new Date("2026-10-24T12:00:00Z");

  it("refuses a save based on an older version and writes nothing", async () => {
    script = { "notePages:select": [[row({ updatedAt: new Date(base.getTime() + 5000) })]] };
    await expect(caller().update({ id: 1, body: "mine", expectedUpdatedAt: base })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sets).toHaveLength(0);
  });

  it("saves when the version matches, moving the stamp forward and guarding the UPDATE", async () => {
    script = { "notePages:select": [[row({ updatedAt: base })]] };
    const result = await caller().update({ id: 1, body: "mine", expectedUpdatedAt: base });
    expect(result.savedAt.getTime()).toBeGreaterThan(base.getTime());
    expect(sets[0].updatedAt).toEqual(result.savedAt);
  });

  it("reports a conflict when another save lands between the read and the UPDATE", async () => {
    script = { "notePages:select": [[row({ updatedAt: base })]], "notePages:update": [[{ affectedRows: 0 }]] };
    await expect(caller().update({ id: 1, body: "mine", expectedUpdatedAt: base })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("always produces a later whole-second stamp", () => {
    expect(nextStamp(base, base.getTime() + 100).getTime()).toBe(base.getTime() + 1000);
    expect(nextStamp(base, base.getTime() + 9500).getTime()).toBe(base.getTime() + 9000);
  });
});

describe("note cap race", () => {
  it("takes back a note when parallel creates pushed the count over the maximum", async () => {
    script = { "notePages:select": [[{ count: String(MAX_NOTE_PAGES_PER_USER - 1) }], [{ count: String(MAX_NOTE_PAGES_PER_USER + 1) }]] };
    await expect(caller().create({ title: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(inserted).toHaveLength(1);
    expect(log).toContain("notePages:delete");
  });

  it("keeps the note when the recount is within the cap", async () => {
    script = { "notePages:select": [[{ count: "3" }], [{ count: "4" }]] };
    await expect(caller().create({ title: "x" })).resolves.toEqual({ id: 9 });
    expect(log).not.toContain("notePages:delete");
  });
});

describe("missing table on update, delete and organize", () => {
  it("says notes are not set up instead of not found", async () => {
    failures = { "notePages:select": missingTable };
    for (const call of [() => caller().update({ id: 1, body: "x" }), () => caller().delete({ id: 1 }), () => caller().organize({ id: 1, mode: "tidy" })]) {
      await expect(call()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Notes are not set up on this server yet." });
    }
  });
});
