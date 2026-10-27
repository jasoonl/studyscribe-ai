import { getTableName } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SOURCES_PER_USER } from "@shared/const";
import { planParts } from "./sourceParts";

// A scripted database: each "<table>:<op>" key holds the results of successive queries on that table.
// Every operation is logged next to the calls to storage so ordering can be asserted.
const log: string[] = [];
let script: Record<string, any[]> = {};
let failures: Record<string, unknown> = {};
const inserted: Array<{ table: string; values: any }> = [];
const sets: Array<{ table: string; values: any }> = [];

function chain(key: string): any {
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
            if (failures[key]) return reject(failures[key]);
            const queue = script[key];
            resolve(queue && queue.length ? queue.shift() : key.endsWith(":select") ? [] : [{ insertId: 1, affectedRows: 1 }]);
          };
        }
        if (prop === "values") return (values: any) => (inserted.push({ table: key.split(":")[0], values }), proxy);
        if (prop === "set") return (values: any) => (sets.push({ table: key.split(":")[0], values }), proxy);
        return () => proxy;
      },
    },
  );
  return proxy;
}
const op = (name: string) => (table: any) => {
  const key = `${getTableName(table)}:${name}`;
  log.push(key);
  return chain(key);
};
const fakeDb: any = {
  select: () => ({ from: op("select") }),
  insert: op("insert"),
  update: op("update"),
  delete: op("delete"),
  transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    log.push("tx:begin");
    try {
      return await work(fakeDb);
    } finally {
      log.push("tx:end");
    }
  },
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));

const storage = vi.hoisted(() => ({
  deleteStoredAudio: vi.fn(),
  verifyUploadedSource: vi.fn(),
  createDirectSourceUpload: vi.fn(),
  isVercelBlobStorageConfigured: vi.fn(() => true),
  isObjectStorageConfigured: vi.fn(() => true),
  storageGetSignedUrl: vi.fn(),
}));
vi.mock("./storage", () => storage);
vi.mock("./slides", () => ({ storageHasRoomForSlides: async () => true }));
const llm = vi.hoisted(() => ({ completeJson: vi.fn(), completeText: vi.fn() }));
vi.mock("./llmJson", () => llm);
const usage = vi.hoisted(() => ({ hasUsage: vi.fn(), recordUsage: vi.fn(), assertCanGenerate: vi.fn() }));
vi.mock("./usage", () => usage);
const courses = vi.hoisted(() => ({ getOwnCourse: vi.fn() }));
vi.mock("./courses", () => courses);

const { sourcesRouter, deleteSourcesForUser, exportSourcesForUser, detachSourcesFromCourse } = await import("./studySources");

const user = { id: 7, role: "user", email: "a@example.com", loginMethod: "email", emailVerified: 1 };
let nextUser = 7;
// A fresh user id per test keeps the in-memory rate limits independent.
const caller = () => sourcesRouter.createCaller({ req: {} as any, res: {} as any, user: { ...user, id: nextUser } as any });

const now = new Date("2026-10-23T12:00:00Z");
const sourceRow = (extra: Record<string, unknown> = {}) => ({
  id: 1, userId: 7, courseId: null, title: "Bio notes", fileName: "bio.pdf", kind: "pdf", storageKey: "7/sources/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-pdf.bin", sizeBytes: 1000,
  status: "extracted", unitCount: 1, charCount: 100, partCount: 1, partsDone: 0, errorMessage: null, summary: null, contentHash: "abc", createdAt: now, updatedAt: now, ...extra,
});
const keyFor = (userId: number, kind = "pdf") => `${userId}/sources/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-${kind}.bin`;

beforeEach(() => {
  nextUser += 1;
  log.length = 0;
  inserted.length = 0;
  sets.length = 0;
  script = {};
  failures = {};
  vi.clearAllMocks();
  storage.deleteStoredAudio.mockImplementation(async () => void log.push("blob:delete"));
  storage.verifyUploadedSource.mockResolvedValue({ size: 1000 });
  storage.isVercelBlobStorageConfigured.mockReturnValue(true);
  storage.isObjectStorageConfigured.mockReturnValue(true);
  usage.hasUsage.mockResolvedValue(false);
  usage.recordUsage.mockResolvedValue({ recorded: true });
  usage.assertCanGenerate.mockResolvedValue(undefined);
  courses.getOwnCourse.mockResolvedValue({ id: 5, archived: false });
});

const own = (extra: Record<string, unknown> = {}) => sourceRow({ userId: nextUser, ...extra });
const missingTable = { code: "ER_NO_SUCH_TABLE", message: "Table 'x.studySources' doesn't exist" };

describe("ownership", () => {
  it("answers NOT_FOUND when the source does not exist or belongs to someone else", async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => caller().get({ id: 1 }),
      () => caller().getUnit({ id: 1, unitIndex: 0 }),
      () => caller().extract({ id: 1 }),
      () => caller().analyzePart({ id: 1, index: 0 }),
      () => caller().finalize({ id: 1 }),
      () => caller().update({ id: 1, title: "x" }),
      () => caller().remove({ id: 1 }),
      () => caller().retry({ id: 1 }),
    ];
    for (const call of calls) {
      script = { "studySources:select": [[]] };
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
      // A row that somehow came back for another user is refused too.
      script = { "studySources:select": [[sourceRow({ userId: 999 })]] };
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
  });
});

describe("missing tables (migration 0034 not applied)", () => {
  it("lists nothing and says the feature is unavailable", async () => {
    failures = { "studySources:select": missingTable };
    await expect(caller().list()).resolves.toEqual({ available: false, sources: [] });
    await expect(caller().flags()).resolves.toEqual([]);
    await expect(caller().get({ id: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("explains itself on writes", async () => {
    failures = { "studySources:select": missingTable };
    await expect(caller().prepareUpload({ fileName: "a.pdf", size: 100 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Study sources are not set up on this server yet." });
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("deletes and exports without failing", async () => {
    failures = { "studySources:select": missingTable };
    await expect(deleteSourcesForUser(7)).resolves.toBeUndefined();
    await expect(exportSourcesForUser(7)).resolves.toEqual({ sources: [], units: [], flags: [] });
    failures = { "studySources:update": missingTable };
    await expect(detachSourcesFromCourse(7, 3)).resolves.toBeUndefined();
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  it("returns sources with flag counts and never the storage key", async () => {
    script = { "studySources:select": [[own()]], "studySourceFlags:select": [[{ sourceId: 1, total: "4" }]] };
    const result = await caller().list();
    expect(result.available).toBe(true);
    expect(result.sources[0]).toMatchObject({ id: 1, title: "Bio notes", status: "extracted", flagCount: 4 });
    expect(JSON.stringify(result)).not.toContain("storageKey");
    expect(JSON.stringify(result)).not.toContain("sources/aaaa");
  });
});

describe("prepareUpload", () => {
  it("refuses legacy and unknown types and oversize files before touching storage", async () => {
    await expect(caller().prepareUpload({ fileName: "old.ppt", size: 10 })).rejects.toThrow(/\.pptx/);
    await expect(caller().prepareUpload({ fileName: "a.exe", size: 10 })).rejects.toThrow(/PDF/);
    await expect(caller().prepareUpload({ fileName: "a.pdf", size: 26 * 1024 * 1024 })).rejects.toThrow(/25MB/);
    await expect(caller().prepareUpload({ fileName: "a.txt", size: 3 * 1024 * 1024 })).rejects.toThrow(/2MB/);
    expect(storage.createDirectSourceUpload).not.toHaveBeenCalled();
  });

  it("returns the signed upload for an allowed file", async () => {
    storage.createDirectSourceUpload.mockResolvedValue({ key: "k", kind: "pdf", uploadUrl: "https://blob/put", uploadContentType: "application/octet-stream" });
    script = { "studySources:select": [[{ count: "0", bytes: "0" }]] };
    await expect(caller().prepareUpload({ fileName: "Lecture 1.PDF", size: 5000 })).resolves.toMatchObject({ key: "k", uploadUrl: "https://blob/put" });
  });

  it("stops at the rate limit", async () => {
    storage.createDirectSourceUpload.mockResolvedValue({ key: "k", kind: "pdf", uploadUrl: "u", uploadContentType: "application/octet-stream" });
    const api = caller();
    for (let i = 0; i < 20; i++) {
      script = { "studySources:select": [[{ count: "0", bytes: "0" }]] };
      await api.prepareUpload({ fileName: "a.pdf", size: 5 });
    }
    await expect(api.prepareUpload({ fileName: "a.pdf", size: 5 })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("register", () => {
  it("rejects another user's key without touching their file", async () => {
    await expect(caller().register({ key: keyFor(nextUser + 1), fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().register({ key: `${nextUser}/recordings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-pdf.bin`, fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().register({ key: `${nextUser}/sources/../${nextUser + 1}/sources/x-pdf.bin`, fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.verifyUploadedSource).not.toHaveBeenCalled();
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
  });

  it("rejects a file whose name and key disagree, and removes the stray upload", async () => {
    await expect(caller().register({ key: keyFor(nextUser, "pptx"), fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.deleteStoredAudio).toHaveBeenCalledWith([keyFor(nextUser, "pptx")]);
  });

  it("rejects an upload that never arrived", async () => {
    storage.verifyUploadedSource.mockRejectedValue(new Error("The uploaded file could not be found in storage. Please upload it again."));
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: /could not be found/ });
  });

  it("refuses past the per-user cap and deletes the uploaded file", async () => {
    script = { "studySources:select": [[], [{ count: String(MAX_SOURCES_PER_USER), bytes: "10" }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: /up to 60/ });
    expect(storage.deleteStoredAudio).toHaveBeenCalledWith([keyFor(nextUser)]);
    expect(inserted).toEqual([]);
  });

  it("refuses past the storage and per-course caps", async () => {
    script = { "studySources:select": [[], [{ count: "1", bytes: String(250 * 1024 * 1024) }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).rejects.toMatchObject({ message: /storage limit/ });
    script = { "studySources:select": [[], [{ count: "1", bytes: "0" }], [{ count: "25" }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf", courseId: 5 })).rejects.toMatchObject({ message: /course can hold/ });
  });

  it("checks the course belongs to the person", async () => {
    courses.getOwnCourse.mockResolvedValue(null);
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf", courseId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates the row with the size storage reported and a title from the file name", async () => {
    storage.verifyUploadedSource.mockResolvedValue({ size: 4321 });
    script = { "studySources:select": [[], [{ count: "0", bytes: "0" }]], "studySources:insert": [[{ insertId: 42 }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "Cell_biology notes.pdf" })).resolves.toEqual({ id: 42 });
    expect(inserted[0].values).toMatchObject({ userId: nextUser, title: "Cell biology notes", kind: "pdf", sizeBytes: 4321, status: "uploaded", courseId: null, storageKey: keyFor(nextUser) });
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
  });
});

describe("register after a lost response", () => {
  it("returns the existing row for the same key without counting it again or deleting its file", async () => {
    script = { "studySources:select": [[{ id: 42 }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).resolves.toEqual({ id: 42 });
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
    expect(storage.verifyUploadedSource).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    // Only the lookup ran; the quota counts were never taken.
    expect(log).toEqual(["studySources:select"]);
  });

  it("returns the winner when two requests race on the same key", async () => {
    failures = { "studySources:insert": { code: "ER_DUP_ENTRY", errno: 1062, message: "dup" } };
    script = { "studySources:select": [[], [{ count: "0", bytes: "0" }], [{ id: 43 }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).resolves.toEqual({ id: 43 });
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
  });

  it("does not delete the file when a row owns it even if the retry fails after the lookup", async () => {
    // First lookup finds nothing, the quota check fails, but by then a concurrent request registered the key.
    script = { "studySources:select": [[], [{ count: String(MAX_SOURCES_PER_USER), bytes: "0" }], [{ id: 44 }]] };
    await expect(caller().register({ key: keyFor(nextUser), fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.deleteStoredAudio).not.toHaveBeenCalled();
  });
});

describe("rate limits", () => {
  it("gives register, extract and analyze their own buckets", async () => {
    const api = caller();
    // 40 registers use up only the register bucket.
    for (let i = 0; i < 40; i++) {
      script = { "studySources:select": [[{ id: i + 1 }]] };
      await api.register({ key: keyFor(nextUser), fileName: "a.pdf" });
    }
    await expect(api.register({ key: keyFor(nextUser), fileName: "a.pdf" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // Extract still works for all the files just registered (40 of them), and then stops.
    for (let i = 0; i < 40; i++) {
      script = { "studySources:select": [[own({ status: "ready" })]] };
      await expect(api.extract({ id: 1 })).resolves.toMatchObject({ status: "ready" });
    }
    script = { "studySources:select": [[own({ status: "ready" })]] };
    await expect(api.extract({ id: 1 })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // Retry shares extract's bucket; analyze and finalize are untouched by both.
    script = { "studySources:select": [[]] };
    await expect(api.retry({ id: 1 })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(api.finalize({ id: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 20_000);

  it("lets several large sources be analysed within ten minutes", async () => {
    const api = caller();
    for (let i = 0; i < 400; i++) {
      script = { "studySources:select": [[]] };
      await expect(api.analyzePart({ id: 1, index: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    script = { "studySources:select": [[]] };
    await expect(api.analyzePart({ id: 1, index: 0 })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  }, 20_000);
});

describe("analyzePart", () => {
  const unitRows = [{ unitIndex: 0, label: "Slide 1: Cells", text: "Photosynthesis is the process by which plants convert light energy into chemical energy. The exam will cover it." }];
  const plan = planParts(unitRows);
  const analysis = { ideas: ["Plants turn light into sugar."], flags: [{ unit: 0, kind: "definition", text: "Photosynthesis converts light energy into chemical energy", quote: "Photosynthesis is the process by which plants convert light energy", importance: 3 }] };

  it("analyses a part once, stores flags and the part, and charges the source once", async () => {
    llm.completeJson.mockResolvedValue(analysis);
    script = {
      "studySources:select": [[own()]],
      "studySourceUnits:select": [unitRows],
      "studySourceParts:select": [[], [{ count: "1" }]],
      "studySourceFlags:select": [[{ count: "0" }]],
    };
    const result = await caller().analyzePart({ id: 1, index: 0 });
    expect(result).toEqual({ index: 0, done: true, partsDone: 1, partCount: 1 });
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
    expect(llm.completeJson.mock.calls[0][0]).toMatchObject({ maxTokens: 1100, timeoutMs: 40_000 });
    expect(usage.assertCanGenerate).toHaveBeenCalledTimes(1);
    expect(usage.recordUsage).toHaveBeenCalledTimes(1);
    expect(usage.recordUsage).toHaveBeenCalledWith({ userId: nextUser, kind: "ai_generation", units: 1, dedupeKey: "source:1" });
    const flagsInsert = inserted.find(item => item.table === "studySourceFlags")!;
    expect(flagsInsert.values[0]).toMatchObject({ sourceId: 1, partIndex: 0, unitIndex: 0, label: "Slide 1: Cells", kind: "definition", importance: 3 });
    const partInsert = inserted.find(item => item.table === "studySourceParts")!;
    expect(partInsert.values).toMatchObject({ partIndex: 0, inputHash: plan[0].hash, ideas: JSON.stringify(analysis.ideas) });
    // The part row is the completion marker, so it is written after the flags.
    expect(log.indexOf("studySourceFlags:insert")).toBeLessThan(log.indexOf("studySourceParts:insert"));
  });

  it("does not charge again once the source has been charged", async () => {
    llm.completeJson.mockResolvedValue(analysis);
    usage.hasUsage.mockResolvedValue(true);
    script = { "studySources:select": [[own({ status: "analyzing", partCount: 2 })]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[], [{ count: "1" }]], "studySourceFlags:select": [[{ count: "0" }]] };
    await caller().analyzePart({ id: 1, index: 0 });
    expect(usage.assertCanGenerate).not.toHaveBeenCalled();
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("is idempotent: a stored part with the same input hash is returned without a model call", async () => {
    script = {
      "studySources:select": [[own({ status: "analyzing" })]],
      "studySourceUnits:select": [unitRows],
      "studySourceParts:select": [[{ partIndex: 0, inputHash: plan[0].hash }], [{ count: "1" }]],
    };
    await expect(caller().analyzePart({ id: 1, index: 0 })).resolves.toMatchObject({ index: 0, done: true, partsDone: 1 });
    expect(llm.completeJson).not.toHaveBeenCalled();
    expect(usage.recordUsage).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("analyses again when the stored part came from different input", async () => {
    llm.completeJson.mockResolvedValue(analysis);
    script = { "studySources:select": [[own()]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[{ partIndex: 0, inputHash: "stale" }], [{ count: "1" }]], "studySourceFlags:select": [[{ count: "0" }]] };
    await caller().analyzePart({ id: 1, index: 0 });
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
  });

  it("retries once as plain text when the structured answer is unusable", async () => {
    llm.completeJson.mockResolvedValue({ nonsense: true });
    llm.completeText.mockResolvedValue("```json\n" + JSON.stringify(analysis) + "\n```");
    script = { "studySources:select": [[own()]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[], [{ count: "1" }]], "studySourceFlags:select": [[{ count: "0" }]] };
    await expect(caller().analyzePart({ id: 1, index: 0 })).resolves.toMatchObject({ done: true });
    expect(llm.completeText).toHaveBeenCalledTimes(1);
  });

  it("fails with an unreadable-answer error, writes nothing and charges nothing when both tries are unusable", async () => {
    llm.completeJson.mockResolvedValue("junk");
    llm.completeText.mockResolvedValue("still junk");
    script = { "studySources:select": [[own()]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[]], "studySourceFlags:select": [[{ count: "0" }]] };
    await expect(caller().analyzePart({ id: 1, index: 0 })).rejects.toMatchObject({ message: /unreadable/ });
    expect(inserted).toEqual([]);
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("turns provider trouble into the standard AI message and does not charge", async () => {
    llm.completeJson.mockRejectedValue(Object.assign(new Error("boom"), { cause: new Error("LLM invoke failed: 429") }));
    script = { "studySources:select": [[own()]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[]], "studySourceFlags:select": [[{ count: "0" }]] };
    await expect(caller().analyzePart({ id: 1, index: 0 })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: /busy/ });
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("refuses a source that has not been read, and a part that does not exist", async () => {
    script = { "studySources:select": [[own({ status: "uploaded" })]] };
    await expect(caller().analyzePart({ id: 1, index: 0 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    script = { "studySources:select": [[own()]], "studySourceUnits:select": [unitRows] };
    await expect(caller().analyzePart({ id: 1, index: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("stops charging nothing when the plan limit refuses the first part", async () => {
    usage.assertCanGenerate.mockRejectedValue(Object.assign(new Error("limit"), { code: "FORBIDDEN" }));
    script = { "studySources:select": [[own()]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[]] };
    await expect(caller().analyzePart({ id: 1, index: 0 })).rejects.toThrow("limit");
    expect(llm.completeJson).not.toHaveBeenCalled();
  });
});

describe("analyzePart time budget, transaction and flag cap", () => {
  const unitRows = [{ unitIndex: 0, label: "Slide 1: Cells", text: "Photosynthesis is the process by which plants convert light energy into chemical energy. The exam will cover it." }];
  const good = { ideas: ["Plants turn light into sugar."], flags: [{ unit: 0, kind: "definition", text: "Photosynthesis converts light energy into chemical energy", quote: "Photosynthesis is the process by which plants convert light energy", importance: 3 }] };
  const base = () => ({ "studySources:select": [own()], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[], [{ count: "1" }]], "studySourceFlags:select": [[{ count: "0" }]] });
  const scriptFor = (flagCount = "0") => {
    const b = base();
    script = { "studySources:select": [[b["studySources:select"][0]]], "studySourceUnits:select": [unitRows], "studySourceParts:select": [[], [{ count: "1" }]], "studySourceFlags:select": [[{ count: flagCount }]] };
  };

  afterEach(() => vi.useRealTimers());

  it("gives the retry only what is left of the budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    llm.completeJson.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 30_000);
      return { nonsense: true };
    });
    llm.completeText.mockResolvedValue(JSON.stringify(good));
    scriptFor();
    await caller().analyzePart({ id: 1, index: 0 });
    expect(llm.completeText.mock.calls[0][0].timeoutMs).toBe(22_000);
  });

  it("skips the retry and reports an unreadable answer when too little time is left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    llm.completeJson.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 45_000);
      return { nonsense: true };
    });
    scriptFor();
    await expect(caller().analyzePart({ id: 1, index: 0 })).rejects.toMatchObject({ message: /unreadable/ });
    expect(llm.completeText).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("replaces a part's flags and writes the part inside one transaction", async () => {
    llm.completeJson.mockImplementation(async () => (log.push("llm"), good));
    scriptFor();
    await caller().analyzePart({ id: 1, index: 0 });
    const begin = log.indexOf("tx:begin");
    const end = log.indexOf("tx:end");
    expect(begin).toBeGreaterThan(-1);
    for (const entry of ["studySourceFlags:delete", "studySourceFlags:insert", "studySourceParts:insert", "studySources:update"]) {
      const at = log.indexOf(entry, begin);
      expect(at).toBeGreaterThan(begin);
      expect(at).toBeLessThan(end);
    }
    // The model call happens before the transaction, so the source row is not locked while it runs.
    expect(log.indexOf("llm")).toBeLessThan(begin);
  });

  it("keeps the per-source flag cap by counting inside the transaction", async () => {
    const three = { ideas: [], flags: [0, 1, 2].map(i => ({ unit: 0, kind: "exam_point", text: `Photosynthesis converts light energy variant ${i}`, quote: null, importance: i === 2 ? 3 : 1 })) };
    llm.completeJson.mockResolvedValue(three);
    scriptFor("58");
    await caller().analyzePart({ id: 1, index: 0 });
    const flags = inserted.find(item => item.table === "studySourceFlags")!.values;
    expect(flags).toHaveLength(2);
    expect(flags.map((flag: any) => flag.importance)).toContain(3);
  });

  it("inserts no flags when the source is already at its cap", async () => {
    llm.completeJson.mockResolvedValue(good);
    scriptFor("60");
    await caller().analyzePart({ id: 1, index: 0 });
    expect(inserted.find(item => item.table === "studySourceFlags")).toBeUndefined();
    expect(inserted.find(item => item.table === "studySourceParts")).toBeDefined();
  });

  it("runs two calls for the same part one transaction at a time", async () => {
    llm.completeJson.mockResolvedValue(good);
    const api = caller();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const realTransaction = fakeDb.transaction;
    let held = false;
    fakeDb.transaction = async (work: any) => {
      // A real database makes the second transaction wait on the source row lock; model that with a queue.
      while (held) await gate;
      held = true;
      order.push("begin");
      try {
        return await realTransaction(work);
      } finally {
        order.push("end");
        held = false;
        release();
      }
    };
    try {
      script = {
        "studySources:select": [[own()], [own()]],
        "studySourceUnits:select": [unitRows, unitRows],
        "studySourceParts:select": [[], [], [{ count: "1" }], [{ count: "1" }]],
        "studySourceFlags:select": [[{ count: "0" }], [{ count: "0" }]],
      };
      await Promise.all([api.analyzePart({ id: 1, index: 0 }), api.analyzePart({ id: 1, index: 0 })]);
    } finally {
      fakeDb.transaction = realTransaction;
    }
    expect(order).toEqual(["begin", "end", "begin", "end"]);
    // Each transaction deleted the part's flags before inserting its own, so a repeat cannot leave duplicates.
    const deletes = log.filter(entry => entry === "studySourceFlags:delete").length;
    const inserts = log.filter(entry => entry === "studySourceFlags:insert").length;
    expect(deletes).toBe(2);
    expect(inserts).toBe(2);
  });
});

describe("extract claim", () => {
  it("does nothing when another request reclaimed the stale row first", async () => {
    script = { "studySources:select": [[own({ status: "extracting", updatedAt: new Date(Date.now() - 10 * 60 * 1000) })], [own({ status: "extracting" })]], "studySources:update": [[{ affectedRows: 0 }]] };
    await expect(caller().extract({ id: 1 })).resolves.toMatchObject({ status: "extracting" });
    expect(storage.storageGetSignedUrl).not.toHaveBeenCalled();
    expect(sets.some(item => item.values.status === "failed")).toBe(false);
  });
});

describe("finalize", () => {
  const parts = [{ partIndex: 0, ideas: JSON.stringify(["One", "Two", "Three", "Four"]) }, { partIndex: 1, ideas: JSON.stringify(["Five"]) }];

  it("needs every part", async () => {
    script = { "studySources:select": [[own({ status: "analyzing", partCount: 2 })]], "studySourceParts:select": [[parts[0]]] };
    await expect(caller().finalize({ id: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("writes the model's summary without HTML and marks the source ready", async () => {
    llm.completeText.mockResolvedValue("## Main ideas\n- <b>One</b>\n- Five");
    script = { "studySources:select": [[own({ status: "analyzing", partCount: 2 })], [own({ status: "ready" })]], "studySourceParts:select": [parts] };
    const result = await caller().finalize({ id: 1 });
    expect(result.status).toBe("ready");
    expect(llm.completeText.mock.calls[0][0]).toMatchObject({ maxTokens: 600 });
    const ready = sets.find(item => item.values.status === "ready")!;
    expect(ready.values.summary).toBe("## Main ideas\n- One\n- Five");
    expect(usage.recordUsage).toHaveBeenCalledWith({ userId: nextUser, kind: "ai_generation", units: 1, dedupeKey: "source:1" });
  });

  it("falls back to the first three ideas of each part when the model fails", async () => {
    llm.completeText.mockRejectedValue(new Error("down"));
    script = { "studySources:select": [[own({ status: "analyzing", partCount: 2 })], [own({ status: "ready" })]], "studySourceParts:select": [parts] };
    await caller().finalize({ id: 1 });
    expect(llm.completeText).toHaveBeenCalledTimes(1);
    const ready = sets.find(item => item.values.status === "ready")!;
    expect(ready.values.summary).toBe("## Main ideas\n\n- One\n- Two\n- Three\n- Five");
    expect(usage.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when already ready and never charges twice", async () => {
    script = { "studySources:select": [[own({ status: "ready", summary: "## Main ideas" })]] };
    await expect(caller().finalize({ id: 1 })).resolves.toMatchObject({ status: "ready" });
    expect(llm.completeText).not.toHaveBeenCalled();
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });
});

describe("remove, retry and update", () => {
  it("removes the file before any row, and stops if the file cannot be removed", async () => {
    script = { "studySources:select": [[own()]] };
    await caller().remove({ id: 1 });
    const blob = log.indexOf("blob:delete");
    expect(blob).toBeGreaterThan(-1);
    expect(log.slice(0, blob).filter(entry => entry.endsWith(":delete"))).toEqual([]);
    expect(log.slice(blob).filter(entry => entry.endsWith(":delete"))).toEqual(expect.arrayContaining(["studySourceFlags:delete", "studySourceParts:delete", "studySourceUnits:delete", "studySources:delete"]));

    log.length = 0;
    storage.deleteStoredAudio.mockRejectedValue(new Error("blob down"));
    script = { "studySources:select": [[own()]] };
    await expect(caller().remove({ id: 1 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: /nothing was deleted/ });
    expect(log.filter(entry => entry.endsWith(":delete"))).toEqual([]);
  });

  it("retries only failed sources", async () => {
    script = { "studySources:select": [[own({ status: "ready" })]] };
    await expect(caller().retry({ id: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    script = { "studySources:select": [[own({ status: "failed", errorMessage: "x" })], [own({ status: "uploaded" })]] };
    await expect(caller().retry({ id: 1 })).resolves.toMatchObject({ status: "uploaded" });
    expect(log).toEqual(expect.arrayContaining(["studySourceFlags:delete", "studySourceParts:delete", "studySourceUnits:delete", "studySources:update"]));
  });

  it("moves a source to one of the person's courses or unfiles it", async () => {
    script = { "studySources:select": [[own()], [{ count: "0" }], [own({ courseId: 5 })]] };
    await expect(caller().update({ id: 1, courseId: 5, title: " New title " })).resolves.toMatchObject({ courseId: 5 });
    courses.getOwnCourse.mockResolvedValue(null);
    script = { "studySources:select": [[own()]] };
    await expect(caller().update({ id: 1, courseId: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    script = { "studySources:select": [[own({ courseId: 5 })], [own({ courseId: null })]] };
    await expect(caller().update({ id: 1, courseId: null })).resolves.toMatchObject({ courseId: null });
  });
});

describe("extract", () => {
  it("returns the current state without work when another request is already extracting", async () => {
    script = { "studySources:select": [[own({ status: "extracting", updatedAt: new Date() })]] };
    await expect(caller().extract({ id: 1 })).resolves.toMatchObject({ status: "extracting" });
    expect(storage.storageGetSignedUrl).not.toHaveBeenCalled();
    script = { "studySources:select": [[own({ status: "ready" })]] };
    await expect(caller().extract({ id: 1 })).resolves.toMatchObject({ status: "ready" });
    expect(storage.storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it("records a failure on the source instead of throwing, with a message fit to show", async () => {
    storage.storageGetSignedUrl.mockResolvedValue("https://blob/get");
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("this is plainly not a pdf", { status: 200 })) as any;
    try {
      script = { "studySources:select": [[own({ status: "uploaded" })], [own({ status: "failed", errorMessage: "shown" })]] };
      const result = await caller().extract({ id: 1 });
      expect(result.status).toBe("failed");
      expect(log.filter(entry => entry === "studySources:update")).toHaveLength(2);
      expect(inserted).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("stores units and moves to extracted for a text file", async () => {
    storage.storageGetSignedUrl.mockResolvedValue("https://blob/get");
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("# Cells\nCells are small.\n# Organs\nOrgans are made of tissue.", { status: 200 })) as any;
    try {
      script = { "studySources:select": [[own({ status: "uploaded", kind: "text", fileName: "n.md" })], [own({ status: "extracted" })]] };
      const result = await caller().extract({ id: 1 });
      expect(result.status).toBe("extracted");
      const units = inserted.find(item => item.table === "studySourceUnits")!.values;
      expect(units.map((unit: any) => [unit.unitIndex, unit.label])).toEqual([[0, "Section 1: Cells"], [1, "Section 2: Organs"]]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("export and account deletion", () => {
  it("exports sources without the storage key or content hash, with their text and flags", async () => {
    script = {
      "studySources:select": [[sourceRow()]],
      "studySourceUnits:select": [[{ id: 1, sourceId: 1, userId: 7, unitIndex: 0, label: "Page 1", text: "hello", createdAt: now }]],
      "studySourceFlags:select": [[{ id: 1, sourceId: 1, userId: 7, partIndex: 0, unitIndex: 0, label: "Page 1", kind: "date", text: "t", quote: null, importance: 2, createdAt: now }]],
    };
    const exported = await exportSourcesForUser(7);
    const json = JSON.stringify(exported);
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain("contentHash");
    expect(json).not.toContain("sources/aaaa");
    expect(exported.sources[0]).toMatchObject({ title: "Bio notes", fileName: "bio.pdf" });
    expect(exported.units[0].text).toBe("hello");
    expect(exported.flags).toHaveLength(1);
    expect(log).not.toContain("studySourceParts:select");
  });

  it("deletes every file before any row, and keeps the rows when a file cannot be deleted", async () => {
    script = { "studySources:select": [[{ storageKey: "a" }, { storageKey: "b" }]] };
    await deleteSourcesForUser(7);
    expect(storage.deleteStoredAudio).toHaveBeenCalledWith(["a", "b"]);
    const blob = log.indexOf("blob:delete");
    expect(log.slice(0, blob).some(entry => entry.endsWith(":delete"))).toBe(false);
    expect(log.slice(blob).filter(entry => entry.endsWith(":delete"))).toEqual(
      expect.arrayContaining(["studySourceFlags:delete", "studySourceParts:delete", "studySourceUnits:delete", "studySources:delete"]),
    );

    log.length = 0;
    storage.deleteStoredAudio.mockRejectedValue(new Error("blob down"));
    script = { "studySources:select": [[{ storageKey: "a" }]] };
    await expect(deleteSourcesForUser(7)).rejects.toThrow("blob down");
    expect(log.filter(entry => entry.endsWith(":delete"))).toEqual([]);
  });

  it("unfiles sources from a course and drops the explanations that quote them", async () => {
    script = { "studySources:select": [[{ id: 4 }]], "questionExplanations:select": [[
      { id: 1, citations: [{ n: 1, recordingId: 0, sourceId: 4 }] },
      { id: 2, citations: [{ n: 1, recordingId: 9 }] },
    ]] };
    await detachSourcesFromCourse(7, 3);
    expect(log).toEqual(["studySources:select", "studySources:update", "questionExplanations:select", "questionExplanations:delete"]);
  });
});
