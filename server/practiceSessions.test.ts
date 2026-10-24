import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log: string[] = [];
let script: Record<string, any[]> = {};
let failures: Record<string, unknown> = {};
const inserted: Array<{ table: string; values: any }> = [];
const sets: Array<{ table: string; values: any }> = [];
const wheres: Array<{ key: string; sql: string; params: unknown[] }> = [];
const dialect = new MySqlDialect();

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
        if (prop === "where") return (condition: any) => (wheres.push({ key, ...(dialect.sqlToQuery(condition) as { sql: string; params: unknown[] }) }), proxy);
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
  selectDistinct: () => ({ from: op("select") }),
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
const dbMock = vi.hoisted(() => ({ getQuizById: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => fakeDb, getQuizById: dbMock.getQuizById }));
const llm = vi.hoisted(() => ({ completeJson: vi.fn() }));
vi.mock("./llmJson", () => llm);
const usage = vi.hoisted(() => ({ hasUsage: vi.fn(), assertCanGenerate: vi.fn(), recordAiGeneration: vi.fn(), AI_BURST_LIMIT: { windowMs: 600000, max: 60 } }));
vi.mock("./usage", () => usage);
const ask = vi.hoisted(() => ({ loadSourcePassages: vi.fn() }));
vi.mock("./ask", () => ask);
const planner = vi.hoisted(() => ({ recordQuizStudy: vi.fn() }));
vi.mock("./planner", () => planner);
const courses = vi.hoisted(() => ({ getOwnCourse: vi.fn(), recordingIdsInCourse: vi.fn() }));
vi.mock("./courses", () => courses);

const mod = await import("./practiceSessions");
const { practiceRouter } = mod;

let nextUser = 500;
const user = () => ({ id: nextUser, role: "user", loginMethod: "email", emailVerified: 1 });
const caller = () => practiceRouter.createCaller({ req: {} as any, res: {} as any, user: user() as any });

const T0 = new Date("2026-10-24T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const LIMIT = 1800;

const questions = [
  { id: "q1", question: "Where is most ATP produced in the cell?", type: "multiple-choice", options: ["Nucleus", "Mitochondria", "Golgi"], correctAnswer: "Mitochondria", explanation: "secret", recordingId: 4 },
  { id: "q2", question: "Name the cycle in the matrix", type: "short-answer", correctAnswer: "Krebs cycle", explanation: "secret", recordingId: 4 },
];
const quiz = () => ({ id: 11, userId: nextUser, recordingId: 4, title: "Cells quiz", questions: questions.map(({ recordingId, ...q }) => q) });

const sessionRow = (extra: Record<string, unknown> = {}) => ({
  id: 5, userId: nextUser, mode: "timed", scope: "quiz", quizId: 11, packId: null, courseId: null, parentSessionId: null, title: "Cells quiz",
  questions, recordingIds: [4], timeLimitSeconds: LIMIT, extraTimePercent: 100, targetCount: null, openKey: "timed-open", startedAt: T0,
  deadlineAt: at(LIMIT), submittedAt: null, autoSubmitted: false, answers: null, score: null, results: null, similarClaimedAt: null, similarAddedAt: null, createdAt: T0, ...extra,
});

beforeEach(() => {
  nextUser += 1;
  log.length = 0;
  inserted.length = 0;
  sets.length = 0;
  wheres.length = 0;
  script = {};
  failures = {};
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(60));
  dbMock.getQuizById.mockImplementation(async () => quiz());
  usage.hasUsage.mockResolvedValue(false);
  usage.assertCanGenerate.mockResolvedValue(undefined);
  usage.recordAiGeneration.mockResolvedValue({ recorded: true });
  ask.loadSourcePassages.mockResolvedValue([]);
  planner.recordQuizStudy.mockResolvedValue(undefined);
  courses.getOwnCourse.mockResolvedValue({ id: 3, name: "Biology", archived: false });
  courses.recordingIdsInCourse.mockResolvedValue([4, 6]);
});
afterEach(() => vi.useRealTimers());

const missing = { code: "ER_NO_SUCH_TABLE", message: "Table 'x.practiceSessions' doesn't exist" };

describe("capabilities", () => {
  it("reports what is set up, and nothing before migration 0035", async () => {
    await expect(caller().capabilities()).resolves.toEqual({ available: true, explanations: true });
    failures = { "practiceSessions:select": missing };
    await expect(caller().capabilities()).resolves.toEqual({ available: false, explanations: false });
    failures = { "questionExplanations:select": missing };
    await expect(caller().capabilities()).resolves.toEqual({ available: true, explanations: false });
  });
});

describe("start", () => {
  it("freezes a timed session with a server deadline and one open key", async () => {
    script = { "practiceSessions:select": [[]], "recordingCourses:select": [[]] };
    const result = await caller().start({ scope: "quiz", quizId: 11, mode: "timed", minutes: 20 });
    expect(result).toMatchObject({ sessionId: 1, resumed: false, timeLimitSeconds: 1200 });
    expect(result.deadlineAt?.toISOString()).toBe(at(60 + 1200).toISOString());
    const row = inserted.find(entry => entry.table === "practiceSessions")!.values;
    expect(row).toMatchObject({ mode: "timed", scope: "quiz", quizId: 11, openKey: "timed-open", timeLimitSeconds: 1200, extraTimePercent: 100 });
    expect(row.questions.map((q: any) => q.id)).toEqual(["q1", "q2"]);
    expect(row.questions[0].correctAnswer).toBe("Mitochondria");
  });

  it("applies extra time and the default of a minute and a half a question", async () => {
    script = { "practiceSessions:select": [[]], "recordingCourses:select": [[]] };
    await caller().start({ scope: "quiz", quizId: 11, mode: "timed", extraTime: 1.5 });
    const row = inserted[0].values;
    expect(row.timeLimitSeconds).toBe(Math.round(5 * 60 * 1.5));
    expect(row.extraTimePercent).toBe(150);
  });

  it("starts an untimed review with no clock and no open key", async () => {
    script = { "recordingCourses:select": [[]] };
    const result = await caller().start({ scope: "quiz", quizId: 11, mode: "review" });
    expect(result.deadlineAt).toBeNull();
    expect(inserted[0].values).toMatchObject({ mode: "review", openKey: null, deadlineAt: null, timeLimitSeconds: null });
  });

  it("resumes the open timed session instead of starting another", async () => {
    script = { "practiceSessions:select": [[sessionRow()]] };
    const result = await caller().start({ scope: "quiz", quizId: 11, mode: "timed" });
    expect(result).toMatchObject({ sessionId: 5, resumed: true, timeLimitSeconds: LIMIT });
    expect(inserted).toHaveLength(0);
  });

  it("finishes an expired open session first, then starts a new one", async () => {
    vi.setSystemTime(at(LIMIT + 120));
    script = { "practiceSessions:select": [[sessionRow({ answers: { q1: "Mitochondria" } })], [sessionRow({ submittedAt: at(LIMIT) })]], "recordingCourses:select": [[]] };
    const result = await caller().start({ scope: "quiz", quizId: 11, mode: "timed" });
    expect(result.resumed).toBe(false);
    expect(sets.find(entry => entry.table === "practiceSessions")!.values).toMatchObject({ autoSubmitted: true, openKey: null, score: 50 });
    expect(inserted.some(entry => entry.table === "practiceSessions")).toBe(true);
  });

  it("falls back to resuming when two starts race for the open key", async () => {
    script = { "practiceSessions:select": [[], [sessionRow()]], "recordingCourses:select": [[]] };
    failures = { "practiceSessions:insert": { code: "ER_DUP_ENTRY", message: "Duplicate entry" } };
    await expect(caller().start({ scope: "quiz", quizId: 11, mode: "timed" })).resolves.toMatchObject({ sessionId: 5, resumed: true });
  });

  it("limits fresh starts to 10 an hour", async () => {
    for (let i = 0; i < 10; i++) {
      script = { "practiceSessions:select": [[]], "recordingCourses:select": [[]] };
      await caller().start({ scope: "quiz", quizId: 11, mode: "review" });
    }
    script = { "recordingCourses:select": [[]] };
    await expect(caller().start({ scope: "quiz", quizId: 11, mode: "review" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("answers NOT_FOUND for someone else's quiz and PRECONDITION_FAILED without questions", async () => {
    dbMock.getQuizById.mockResolvedValue({ ...quiz(), userId: 1 });
    await expect(caller().start({ scope: "quiz", quizId: 11, mode: "review" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    dbMock.getQuizById.mockResolvedValue({ ...quiz(), questions: [] });
    await expect(caller().start({ scope: "quiz", quizId: 11, mode: "review" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    script = { "examPacks:select": [[]] };
    await expect(caller().start({ scope: "pack", packId: 2, mode: "review" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    courses.getOwnCourse.mockResolvedValue(null);
    await expect(caller().start({ scope: "course", courseId: 3, mode: "review" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("samples a course from its quizzes and packs, dedupes and tags recordings", async () => {
    const q = (id: string, text: string) => ({ id, question: text, type: "short-answer", correctAnswer: "x", explanation: "" });
    script = {
      "quizzes:select": [[
        { userId: nextUser, recordingId: 4, questions: [q("q1", "Alpha question?"), q("q2", "Beta question?")] },
        { userId: nextUser, recordingId: 6, questions: [q("q1", "alpha question?"), q("q2", "Gamma question?")] },
      ]],
      "examPacks:select": [[{ userId: nextUser, courseId: 3, questions: [{ ...q("q1", "Delta question?"), recordingId: 6 }] }]],
    };
    await caller().start({ scope: "course", courseId: 3, mode: "review", questionCount: 5 });
    const row = inserted[0].values;
    expect(row.questions.map((x: any) => x.question).sort()).toEqual(["Alpha question?", "Beta question?", "Delta question?", "Gamma question?"]);
    expect(row.questions.map((x: any) => x.id).sort()).toEqual(["q1", "q2", "q3", "q4"]);
    expect(new Set(row.recordingIds)).toEqual(new Set([4, 6]));
    expect(row).toMatchObject({ scope: "course", courseId: 3, title: "Biology practice" });
  });

  it("explains itself before migration 0035", async () => {
    failures = { "practiceSessions:select": missing };
    await expect(caller().start({ scope: "quiz", quizId: 11, mode: "timed" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Practice exams are not set up on this server yet." });
  });
});

describe("get", () => {
  it("never sends answers or stored explanations while the session is open", async () => {
    script = { "practiceSessions:select": [[sessionRow({ answers: { q1: "Nucleus", q9: "stray" } })]] };
    const view = await caller().get({ sessionId: 5 });
    expect(view).toMatchObject({ id: 5, status: "open", mode: "timed", timeLimitSeconds: LIMIT, answers: { q1: "Nucleus" }, extraTime: null });
    expect(view.serverNow.toISOString()).toBe(at(60).toISOString());
    expect(view.deadlineAt?.toISOString()).toBe(at(LIMIT).toISOString());
    expect(view).not.toHaveProperty("result");
    expect(JSON.stringify(view)).not.toMatch(/correctAnswer|explanation|secret|Krebs cycle"/);
  });

  it("is NOT_FOUND for someone else's session", async () => {
    script = { "practiceSessions:select": [[]] };
    await expect(caller().get({ sessionId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stays open through the grace period, then finishes from the saved answers", async () => {
    vi.setSystemTime(at(LIMIT + 15));
    script = { "practiceSessions:select": [[sessionRow({ answers: { q1: "Mitochondria" } })]] };
    expect((await caller().get({ sessionId: 5 })).status).toBe("open");
    expect(sets).toHaveLength(0);

    vi.setSystemTime(at(LIMIT + 16));
    script = { "practiceSessions:select": [
      [sessionRow({ answers: { q1: "Mitochondria", q2: "Krebs cycle" } })],
      [sessionRow({ answers: { q1: "Mitochondria", q2: "Krebs cycle" }, submittedAt: at(LIMIT), autoSubmitted: true, score: 100 })],
    ] };
    const done = await caller().get({ sessionId: 5 });
    expect(done.status).toBe("submitted");
    expect(done.result).toMatchObject({ score: 100, autoSubmitted: true, secondsUsed: LIMIT });
    expect(done.result!.results[0]).toEqual({ id: "q1", correct: true, correctAnswer: "Mitochondria", userAnswer: "Mitochondria", recordingId: 4 });
    expect(sets[0].values).toMatchObject({ autoSubmitted: true, openKey: null, answers: { q1: "Mitochondria", q2: "Krebs cycle" } });
    expect(sets[0].values.submittedAt.toISOString()).toBe(at(LIMIT).toISOString());
  });

  it("shows the result of a submitted session", async () => {
    script = { "practiceSessions:select": [[sessionRow({ submittedAt: at(600), answers: { q1: "Nucleus" }, mode: "timed", extraTimePercent: 125 })]] };
    const view = await caller().get({ sessionId: 5 });
    expect(view).toMatchObject({ status: "submitted", extraTime: 1.25, result: { score: 0, correct: 0, total: 2, autoSubmitted: false, secondsUsed: 600 } });
  });
});

describe("saveAnswers", () => {
  it("merges into the saved answers and drops stray ids", async () => {
    script = { "practiceSessions:select": [[sessionRow({ answers: { q1: "Nucleus" } })]] };
    await caller().saveAnswers({ sessionId: 5, answers: { q2: "Krebs", zz: "x" } });
    expect(sets[0].values.answers).toEqual({ q1: "Nucleus", q2: "Krebs" });
  });

  it("is refused after a submission and once the time (plus grace) is over, finishing the session", async () => {
    script = { "practiceSessions:select": [[sessionRow({ submittedAt: at(100) })]] };
    await expect(caller().saveAnswers({ sessionId: 5, answers: { q1: "x" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    vi.setSystemTime(at(LIMIT + 30));
    script = { "practiceSessions:select": [[sessionRow()], [sessionRow({ submittedAt: at(LIMIT) })]] };
    await expect(caller().saveAnswers({ sessionId: 5, answers: { q1: "x" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/Time is up/) });
    expect(sets.some(entry => entry.values.autoSubmitted === true)).toBe(true);
  });

  it("still saves in the grace period", async () => {
    vi.setSystemTime(at(LIMIT + 10));
    script = { "practiceSessions:select": [[sessionRow()]] };
    await expect(caller().saveAnswers({ sessionId: 5, answers: { q1: "x" } })).resolves.toHaveProperty("savedAt");
  });
});

describe("submit", () => {
  it("scores the submitted answers and reports the time used", async () => {
    vi.setSystemTime(at(600));
    script = { "practiceSessions:select": [[sessionRow({ answers: { q1: "Nucleus" } })]] };
    const result = await caller().submit({ sessionId: 5, answers: { q1: "Mitochondria", q2: "the krebs cycle" }, localDate: "2026-10-24" });
    expect(result).toMatchObject({ score: 100, correct: 2, total: 2, autoSubmitted: false, secondsUsed: 600 });
    expect(result.results[1]).toMatchObject({ id: "q2", correct: true, correctAnswer: "Krebs cycle", userAnswer: "the krebs cycle" });
    expect(sets[0].values).toMatchObject({ autoSubmitted: false, openKey: null, score: 100 });
  });

  it("accepts a submit inside the grace period as on time", async () => {
    vi.setSystemTime(at(LIMIT + 15));
    script = { "practiceSessions:select": [[sessionRow()]] };
    const result = await caller().submit({ sessionId: 5, answers: { q1: "Mitochondria" } });
    expect(result).toMatchObject({ autoSubmitted: false, correct: 1 });
    expect(result.secondsUsed).toBe(LIMIT);
  });

  it("scores a late submit from the saved answers only, never rejecting it", async () => {
    vi.setSystemTime(at(LIMIT + 16));
    script = { "practiceSessions:select": [[sessionRow({ answers: { q1: "Nucleus" } })]] };
    const result = await caller().submit({ sessionId: 5, answers: { q1: "Mitochondria", q2: "Krebs cycle" } });
    expect(result).toMatchObject({ autoSubmitted: true, correct: 0, score: 0, secondsUsed: LIMIT });
    expect(sets[0].values.answers).toEqual({ q1: "Nucleus" });
  });

  it("returns the first result when submitted twice, writing nothing again", async () => {
    script = { "practiceSessions:select": [[sessionRow({ submittedAt: at(300), answers: { q1: "Mitochondria" } })]] };
    const result = await caller().submit({ sessionId: 5, answers: { q1: "Nucleus", q2: "x" } });
    expect(result).toMatchObject({ correct: 1, secondsUsed: 300 });
    expect(sets).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(planner.recordQuizStudy).not.toHaveBeenCalled();
  });

  it("when a parallel request closes it first, returns the stored result with no attempt row or study event", async () => {
    script = {
      "practiceSessions:select": [[sessionRow()], [sessionRow({ submittedAt: at(70), answers: { q1: "Mitochondria" }, autoSubmitted: true })]],
      "practiceSessions:update": [[{ affectedRows: 0 }]],
    };
    const result = await caller().submit({ sessionId: 5, answers: { q1: "Nucleus" } });
    expect(result).toMatchObject({ correct: 1, autoSubmitted: true });
    expect(inserted.filter(entry => entry.table === "quizAttempts")).toHaveLength(0);
    expect(planner.recordQuizStudy).not.toHaveBeenCalled();
  });

  it("records a quiz attempt and a study event for a whole-quiz run, in one transaction", async () => {
    script = { "practiceSessions:select": [[sessionRow()]] };
    await caller().submit({ sessionId: 5, answers: { q1: "Mitochondria", q2: "Krebs cycle" }, localDate: "2026-10-24" });
    expect(inserted.find(entry => entry.table === "quizAttempts")!.values).toMatchObject({ quizId: 11, userId: nextUser, score: 100 });
    expect(log.indexOf("tx:begin")).toBeLessThan(log.indexOf("quizAttempts:insert"));
    expect(log.indexOf("quizAttempts:insert")).toBeLessThan(log.indexOf("tx:end"));
    expect(planner.recordQuizStudy).toHaveBeenCalledWith({ userId: nextUser, recordingId: 4, quizId: 11, score: 100, localDate: "2026-10-24" });
  });

  it("does not add a quiz attempt for a partial run, but still logs the study", async () => {
    script = { "practiceSessions:select": [[sessionRow({ questions: [questions[0]] })]] };
    await caller().submit({ sessionId: 5, answers: { q1: "Mitochondria" } });
    expect(inserted.filter(entry => entry.table === "quizAttempts")).toHaveLength(0);
    expect(planner.recordQuizStudy).toHaveBeenCalledTimes(1);
  });

  it("logs a missed-only run as study, never as a quiz attempt, and ignores packs and courses", async () => {
    script = { "practiceSessions:select": [[sessionRow({ scope: "missed", mode: "review", deadlineAt: null, timeLimitSeconds: null, openKey: null })]] };
    await caller().submit({ sessionId: 5, answers: { q1: "Mitochondria", q2: "Krebs cycle" } });
    expect(inserted.filter(entry => entry.table === "quizAttempts")).toHaveLength(0);
    expect(planner.recordQuizStudy).toHaveBeenCalledTimes(1);

    planner.recordQuizStudy.mockClear();
    script = { "practiceSessions:select": [[sessionRow({ scope: "pack", quizId: null, packId: 2 })]] };
    await caller().submit({ sessionId: 5, answers: {} });
    expect(planner.recordQuizStudy).not.toHaveBeenCalled();
  });

  it("is NOT_FOUND for someone else's session and lets an untimed run submit any time", async () => {
    script = { "practiceSessions:select": [[]] };
    await expect(caller().submit({ sessionId: 5, answers: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.setSystemTime(at(999999));
    script = { "practiceSessions:select": [[sessionRow({ mode: "review", deadlineAt: null, timeLimitSeconds: null, openKey: null })]] };
    await expect(caller().submit({ sessionId: 5, answers: { q1: "Mitochondria" } })).resolves.toMatchObject({ autoSubmitted: false, correct: 1 });
  });
});

describe("list and discard", () => {
  it("finishes overdue sessions, then lists the newest", async () => {
    vi.setSystemTime(at(LIMIT + 600));
    script = { "practiceSessions:select": [
      [sessionRow()],
      [sessionRow({ submittedAt: at(LIMIT) })],
      [{ id: 5, title: "Cells quiz", scope: "quiz", mode: "timed", score: 0, submittedAt: at(LIMIT), createdAt: T0 }, { id: 4, title: "Open", scope: "pack", mode: "review", score: null, submittedAt: null, createdAt: T0 }],
    ] };
    const rows = await caller().list();
    expect(rows.map(row => [row.id, row.status])).toEqual([[5, "submitted"], [4, "open"]]);
    expect(sets.some(entry => entry.values.autoSubmitted === true)).toBe(true);
  });

  it("is empty before migration 0035", async () => {
    failures = { "practiceSessions:select": missing };
    await expect(caller().list()).resolves.toEqual([]);
  });

  it("discards an open session only", async () => {
    script = { "practiceSessions:select": [[sessionRow()]] };
    await expect(caller().discard({ sessionId: 5 })).resolves.toEqual({ discarded: true });
    expect(log).toContain("practiceSessions:delete");
    log.length = 0;
    script = { "practiceSessions:select": [[sessionRow({ submittedAt: at(5) })]] };
    await expect(caller().discard({ sessionId: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(log).not.toContain("practiceSessions:delete");
    script = { "practiceSessions:select": [[]] };
    await expect(caller().discard({ sessionId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("missedFrom", () => {
  const submitted = (extra: Record<string, unknown> = {}) => sessionRow({ submittedAt: at(300), answers: { q1: "Nucleus", q2: "Krebs cycle" }, ...extra });

  it("copies the missed questions verbatim into a new review run linked to its parent", async () => {
    script = { "practiceSessions:select": [[submitted()], []], "recordingCourses:select": [[]] };
    const result = await caller().missedFrom({ origin: { sessionId: 5 }, similar: true, questionCount: 6 });
    expect(result).toEqual({ sessionId: 1 });
    const row = inserted.find(entry => entry.table === "practiceSessions")!.values;
    expect(row).toMatchObject({ mode: "review", scope: "missed", parentSessionId: 5, quizId: 11, targetCount: 6, userId: nextUser });
    expect(row.questions).toHaveLength(1);
    expect(row.questions[0]).toMatchObject({ id: "q1", question: questions[0].question, correctAnswer: "Mitochondria" });
    expect(llm.completeJson).not.toHaveBeenCalled();
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
  });

  it("derives the misses from the latest quiz attempt", async () => {
    script = {
      "quizzes:select": [[quiz()]],
      "quizAttempts:select": [[{ id: 31, quizId: 11, userId: nextUser, answers: { q1: "Mitochondria", q2: "wrong" } }]],
      "recordingCourses:select": [[]],
      "practiceSessions:select": [[]],
    };
    await caller().missedFrom({ origin: { quizId: 11 } });
    const row = inserted.find(entry => entry.table === "practiceSessions")!.values;
    expect(row.questions.map((q: any) => q.question)).toEqual([questions[1].question]);
    expect(row.parentSessionId).toBeNull();
    expect(row.quizId).toBe(11);
  });

  it("returns the open run for the same misses instead of making another", async () => {
    const existing = sessionRow({ id: 9, scope: "missed", mode: "review", parentSessionId: 5, questions: [{ ...questions[0], id: "q1" }, { ...questions[0], id: "q2", question: "added later?" }] });
    script = { "practiceSessions:select": [[submitted()], [existing]], "recordingCourses:select": [[]] };
    await expect(caller().missedFrom({ origin: { sessionId: 5 } })).resolves.toEqual({ sessionId: 9 });
    expect(inserted).toHaveLength(0);
  });

  it("refuses when nothing was missed, an open session or someone else's", async () => {
    script = { "practiceSessions:select": [[submitted({ answers: { q1: "Mitochondria", q2: "Krebs cycle" } })], []], "recordingCourses:select": [[]] };
    await expect(caller().missedFrom({ origin: { sessionId: 5 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    script = { "practiceSessions:select": [[sessionRow()]] };
    await expect(caller().missedFrom({ origin: { sessionId: 5 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    script = { "practiceSessions:select": [[]] };
    await expect(caller().missedFrom({ origin: { sessionId: 5 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("addSimilar", () => {
  const missedRow = (extra: Record<string, unknown> = {}) => sessionRow({ id: 9, scope: "missed", mode: "review", openKey: null, deadlineAt: null, timeLimitSeconds: null, parentSessionId: 5, targetCount: 4, questions: [questions[0]], ...extra });
  const transcript = { recordingId: 4, title: "Cell biology", fullText: "Most ATP is produced in the mitochondria through oxidative phosphorylation. The Golgi packages proteins.", segments: null };
  const generated = { questions: [
    { question: "What drives oxidative phosphorylation?", type: "multiple-choice", options: ["Mitochondria", "Golgi"], correctAnswer: "Mitochondria", explanation: "e", source: 1 },
    { question: "Where is most ATP produced in the cell?", type: "short-answer", options: [], correctAnswer: "Mitochondria", explanation: "e", source: 1 },
  ] };

  it("adds new look-alike questions grounded in their material and charges one generation", async () => {
    llm.completeJson.mockResolvedValue(generated);
    script = { "practiceSessions:select": [[missedRow()]], "recordings:select": [[transcript]] };
    const result = await caller().addSimilar({ sessionId: 9 });
    expect(result).toEqual({ added: 1 });
    const saved = sets.filter(entry => entry.values.questions)[0].values;
    expect(saved.questions.map((q: any) => q.id)).toEqual(["q1", "q2"]);
    expect(saved.questions[1].question).toBe("What drives oxidative phosphorylation?");
    expect(llm.completeJson.mock.calls[0][0]).toMatchObject({ timeoutMs: 40_000 });
    expect(usage.recordAiGeneration).toHaveBeenCalledWith(nextUser, "similar:9");
  });

  it("makes no model call and no charge when nothing of theirs matches", async () => {
    script = { "practiceSessions:select": [[missedRow()]], "recordings:select": [[{ ...transcript, fullText: "Medieval salt trade." }]] };
    await expect(caller().addSimilar({ sessionId: 9 })).resolves.toEqual({ added: 0 });
    expect(llm.completeJson).not.toHaveBeenCalled();
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
    expect(sets.some(entry => entry.values.similarAddedAt)).toBe(true);
  });

  it("charges nothing and lets the person retry when no new question came back", async () => {
    llm.completeJson.mockResolvedValue({ questions: [generated.questions[1]] });
    script = { "practiceSessions:select": [[missedRow()]], "recordings:select": [[transcript]] };
    await expect(caller().addSimilar({ sessionId: 9 })).resolves.toEqual({ added: 0 });
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
    expect(sets.some(entry => entry.values.similarAddedAt)).toBe(false);
    expect(sets.some(entry => entry.values.questions)).toBe(false);
    expect(sets.some(entry => entry.values.similarClaimedAt === null)).toBe(true);
  });

  it("is a no-op once added, at the target, or while another request holds the claim", async () => {
    script = { "practiceSessions:select": [[missedRow({ similarAddedAt: at(30) })]] };
    await expect(caller().addSimilar({ sessionId: 9 })).resolves.toEqual({ added: 0 });
    script = { "practiceSessions:select": [[missedRow({ targetCount: 1 })]] };
    await expect(caller().addSimilar({ sessionId: 9 })).resolves.toEqual({ added: 0 });
    script = { "practiceSessions:select": [[missedRow()]], "practiceSessions:update": [[{ affectedRows: 0 }]] };
    await expect(caller().addSimilar({ sessionId: 9 })).resolves.toEqual({ added: 0 });
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it("releases its claim and charges nothing when the model fails", async () => {
    llm.completeJson.mockRejectedValue(new Error("boom"));
    script = { "practiceSessions:select": [[missedRow()]], "recordings:select": [[transcript]] };
    await expect(caller().addSimilar({ sessionId: 9 })).rejects.toThrow("boom");
    expect(sets.some(entry => entry.values.similarClaimedAt === null)).toBe(true);
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
  });

  it("does not charge a second time for a session already billed, and checks the allowance only when unbilled", async () => {
    usage.hasUsage.mockResolvedValue(true);
    llm.completeJson.mockResolvedValue(generated);
    script = { "practiceSessions:select": [[missedRow()]], "recordings:select": [[transcript]] };
    await caller().addSimilar({ sessionId: 9 });
    expect(usage.assertCanGenerate).not.toHaveBeenCalled();
  });

  it("will not add to a finished run or a run of another kind, or to someone else's", async () => {
    script = { "practiceSessions:select": [[missedRow({ submittedAt: at(5) })]] };
    await expect(caller().addSimilar({ sessionId: 9 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    script = { "practiceSessions:select": [[sessionRow()]] };
    await expect(caller().addSimilar({ sessionId: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    script = { "practiceSessions:select": [[]] };
    await expect(caller().addSimilar({ sessionId: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("pack attempts, deletion and export", () => {
  it("records a pack attempt as a submitted session and never fails the attempt", async () => {
    const id = await mod.recordPackAttempt({ userId: 7, packId: 2, title: "Pack", questions: questions as any, answers: { q1: "Nucleus" }, recordingIds: [4], courseId: null, score: 0 });
    expect(id).toBe(1);
    expect(inserted[0].values).toMatchObject({ scope: "pack", packId: 2, mode: "review", score: 0 });
    expect(inserted[0].values).not.toHaveProperty("openKey");
    expect(inserted[0].values.submittedAt).toBeInstanceOf(Date);
    failures = { "practiceSessions:insert": missing };
    await expect(mod.recordPackAttempt({ userId: 7, packId: 2, title: "Pack", questions: questions as any, answers: {}, recordingIds: [], courseId: null, score: 0 })).resolves.toBeNull();
  });

  it("keeps only the newest 20 attempts of a pack, never the one just recorded, and drops their explanations", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => ({ id: 100 - i }));
    script = { "practiceSessions:insert": [[{ insertId: 100 }]], "practiceSessions:select": [ids] };
    const id = await mod.recordPackAttempt({ userId: 7, packId: 2, title: "Pack", questions: questions as any, answers: {}, recordingIds: [4], courseId: null, score: 0 });
    expect(id).toBe(100);
    expect(log).toEqual(["practiceSessions:insert", "practiceSessions:select", "practiceSessions:delete", "questionExplanations:delete"]);
    const del = wheres.find(entry => entry.key === "practiceSessions:delete")!;
    expect(del.params).toEqual([7, 80, 79, 78, 77, 76]);
    expect(wheres.find(entry => entry.key === "questionExplanations:delete")!.params).toEqual([7, "session:80", "session:79", "session:78", "session:77", "session:76"]);
  });

  it("prunes nothing when a pack has 20 or fewer attempts, and a prune failure never fails the attempt", async () => {
    script = { "practiceSessions:insert": [[{ insertId: 5 }]], "practiceSessions:select": [Array.from({ length: 20 }, (_, i) => ({ id: 5 - i }))] };
    await expect(mod.recordPackAttempt({ userId: 7, packId: 2, title: "P", questions: questions as any, answers: {}, recordingIds: [], courseId: null, score: 0 })).resolves.toBe(5);
    expect(log).not.toContain("practiceSessions:delete");
    log.length = 0;
    failures = { "practiceSessions:select": new Error("boom") };
    await expect(mod.recordPackAttempt({ userId: 7, packId: 2, title: "P", questions: questions as any, answers: {}, recordingIds: [], courseId: null, score: 0 })).resolves.toBe(1);
  });

  it("deletes sessions of removed packs and of purged recordings", async () => {
    await mod.deleteSessionsForPacks(7, [2]);
    expect(log).toEqual(["practiceSessions:delete"]);
    // Scoped to the owner as well as the pack ids.
    const where = wheres.find(entry => entry.key === "practiceSessions:delete")!;
    expect(where.sql).toMatch(/`userId` in/);
    expect(where.sql).toMatch(/`packId` in/);
    expect(where.params).toEqual([7, 2]);
    log.length = 0;
    script = {
      "recordings:select": [[{ userId: 7 }]],
      "practiceSessions:select": [[
        { id: 1, recordingIds: [4, 5], questions: [] },
        { id: 2, recordingIds: [9], questions: [{ id: "q1", question: "x", type: "short-answer", correctAnswer: "y", recordingId: 4 }] },
        { id: 3, recordingIds: [9], questions: [] },
      ]],
    };
    await mod.deleteSessionsForRecordings([4]);
    expect(log).toEqual(["recordings:select", "practiceSessions:select", "practiceSessions:delete"]);
  });

  it("tolerates missing tables everywhere and exports without internals", async () => {
    failures = { "practiceSessions:select": missing, "practiceSessions:delete": missing };
    await expect(mod.deleteSessionsForPacks(7, [1])).resolves.toBeUndefined();
    await expect(mod.deleteSessionsForRecordings([1])).resolves.toBeUndefined();
    await expect(mod.deleteSessionsForUser(7)).resolves.toBeUndefined();
    await expect(mod.exportSessionsForUser(7)).resolves.toEqual([]);
    failures = {};
    script = { "practiceSessions:select": [[sessionRow()]] };
    const [row] = await mod.exportSessionsForUser(7);
    expect(row).not.toHaveProperty("openKey");
    expect(row).not.toHaveProperty("userId");
    expect(row).toMatchObject({ title: "Cells quiz" });
  });
});
