import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const log: string[] = [];
let script: Record<string, any[]> = {};
let failures: Record<string, unknown> = {};
const inserted: Array<{ table: string; values: any }> = [];

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
  selectDistinct: () => ({ from: op("select") }),
  insert: op("insert"),
  update: op("update"),
  delete: op("delete"),
  transaction: async (work: (tx: unknown) => Promise<unknown>) => work(fakeDb),
};
const dbMock = vi.hoisted(() => ({ getQuizById: vi.fn(), getRecordingById: vi.fn(), createQuizAttempt: vi.fn() }));
vi.mock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db")>()), getDb: async () => fakeDb, ...dbMock }));
const planner = vi.hoisted(() => ({ recordQuizStudy: vi.fn() }));
vi.mock("./planner", async importOriginal => ({ ...(await importOriginal<typeof import("./planner")>()), recordQuizStudy: planner.recordQuizStudy, deletePlannerDataForRecordings: async () => void log.push("planner:delete") }));
const storage = vi.hoisted(() => ({ deleteStoredAudio: vi.fn() }));
vi.mock("./storage", async importOriginal => ({ ...(await importOriginal<typeof import("./storage")>()), deleteStoredAudio: storage.deleteStoredAudio }));

const { appRouter } = await import("./routers");
const { purgeRecordings } = await import("./purgeRecordings");

let nextUser = 900;
const caller = () => appRouter.createCaller({ req: { protocol: "https", headers: {} } as any, res: {} as any, user: { id: nextUser, role: "user", loginMethod: "email", emailVerified: 1 } as any });

const questions = [
  { id: "q1", question: "Where is ATP made?", type: "multiple-choice", options: ["Nucleus", "Mitochondria"], correctAnswer: "Mitochondria", explanation: "e" },
  { id: "q2", question: "Name the cycle", type: "short-answer", correctAnswer: "The Café cycle", explanation: "e" },
];
const missing = { code: "ER_NO_SUCH_TABLE", message: "Table doesn't exist" };

beforeEach(() => {
  nextUser += 1;
  log.length = 0;
  inserted.length = 0;
  script = {};
  failures = {};
  vi.clearAllMocks();
  dbMock.getQuizById.mockImplementation(async () => ({ id: 11, userId: nextUser, recordingId: 4, title: "Quiz", questions }));
  dbMock.getRecordingById.mockImplementation(async () => ({ id: 4, userId: nextUser }));
  dbMock.createQuizAttempt.mockResolvedValue([{ insertId: 77 }]);
});

describe("quizzes.submitAttempt (additive)", () => {
  it("keeps score, correct and total and adds the attempt id and per-question results", async () => {
    const result = await caller().quizzes.submitAttempt({ quizId: 11, answers: { q1: "Nucleus", q2: "cafe cycle" }, localDate: "2026-10-24" });
    expect(result).toMatchObject({ score: 50, correct: 1, total: 2, attemptId: 77 });
    expect(result.results).toEqual([
      { id: "q1", correct: false, correctAnswer: "Mitochondria", userAnswer: "Nucleus", recordingId: 4 },
      { id: "q2", correct: true, correctAnswer: "The Café cycle", userAnswer: "cafe cycle", recordingId: 4 },
    ]);
    expect(dbMock.createQuizAttempt).toHaveBeenCalledWith({ quizId: 11, userId: nextUser, answers: { q1: "Nucleus", q2: "cafe cycle" }, score: 50 });
    expect(planner.recordQuizStudy).toHaveBeenCalledWith(expect.objectContaining({ quizId: 11, score: 50 }));
  });

  it("still refuses someone else's quiz", async () => {
    dbMock.getRecordingById.mockResolvedValue({ id: 4, userId: 1 });
    await expect(caller().quizzes.submitAttempt({ quizId: 11, answers: {} })).rejects.toThrow("Access denied");
  });
});

describe("examPacks.submitAttempt (additive)", () => {
  const pack = () => ({ id: 3, userId: nextUser, title: "Pack", courseId: null, recordingIds: [4], questions });

  it("returns detailed results and the session that holds the attempt", async () => {
    script = { "examPacks:select": [[pack()]] };
    const result = await caller().examPacks.submitAttempt({ id: 3, answers: { q1: "Mitochondria" } });
    expect(result).toMatchObject({ score: 50, correct: 1, total: 2, sessionId: 1 });
    expect(result.results[1]).toEqual({ id: "q2", correct: false, correctAnswer: "The Café cycle", userAnswer: "" });
    const session = inserted.find(entry => entry.table === "practiceSessions")!.values;
    expect(session).toMatchObject({ scope: "pack", packId: 3, mode: "review", score: 50, userId: nextUser });
    expect(session.questions[0].correctAnswer).toBe("Mitochondria");
  });

  it("works unchanged before migration 0035, with no session", async () => {
    script = { "examPacks:select": [[pack()]] };
    failures = { "practiceSessions:insert": missing };
    const result = await caller().examPacks.submitAttempt({ id: 3, answers: {} });
    expect(result).toMatchObject({ score: 0, total: 2, sessionId: null });
  });

  it("removing your own pack removes its practice sessions", async () => {
    script = { "examPacks:select": [[{ id: 3 }]] };
    await caller().examPacks.remove({ id: 3 });
    expect(log).toEqual(["examPacks:select", "examPacks:delete", "practiceSessions:delete"]);
  });

  it("removing a pack that is not yours touches nothing, so another person's sessions survive", async () => {
    // The ownership-scoped lookup finds no row for this caller.
    script = { "examPacks:select": [[]] };
    await expect(caller().examPacks.remove({ id: 3 })).resolves.toEqual({ removed: true });
    expect(log).toEqual(["examPacks:select"]);
  });
});

describe("permanent deletion", () => {
  it("removes practice sessions and explanations before the recordings, and tolerates missing tables", async () => {
    script = { "recordings:select": [[{ userId: 7 }], [{ userId: 7 }], [{ userId: 7 }]] };
    await purgeRecordings([{ id: 4, audioKey: "k" }]);
    const recordingsDelete = log.lastIndexOf("recordings:delete");
    expect(log.indexOf("practiceSessions:select")).toBeGreaterThan(-1);
    expect(log.indexOf("questionExplanations:select")).toBeGreaterThan(-1);
    expect(log.indexOf("practiceSessions:select")).toBeLessThan(recordingsDelete);
    expect(log.indexOf("questionExplanations:select")).toBeLessThan(recordingsDelete);

    log.length = 0;
    script = { "recordings:select": [[{ userId: 7 }], [{ userId: 7 }], [{ userId: 7 }]] };
    failures = { "practiceSessions:select": missing, "questionExplanations:select": missing };
    await expect(purgeRecordings([{ id: 4, audioKey: "k" }])).resolves.toEqual({ deleted: 1 });
  });
});
