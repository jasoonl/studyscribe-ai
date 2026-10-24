import { getTableName } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted database: each "<table>:<op>" key holds the results of successive queries on that table.
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
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));

const llm = vi.hoisted(() => ({ completeJson: vi.fn() }));
vi.mock("./llmJson", () => llm);
const usage = vi.hoisted(() => ({
  hasUsage: vi.fn(), assertCanGenerate: vi.fn(), recordAiGeneration: vi.fn(), AI_BURST_LIMIT: { windowMs: 600000, max: 60 },
}));
vi.mock("./usage", () => usage);
const ask = vi.hoisted(() => ({ loadSourcePassages: vi.fn() }));
vi.mock("./ask", () => ask);

const { mistakesRouter, explainMistake, deleteExplanationsForRecordings, deleteExplanationsForSources, deleteExplanationsForUser, exportExplanationsForUser, EXPLAIN_BUDGET_MS, EXPLANATION_CAP_MESSAGE } = await import("./mistakeExplanations");

let nextUser = 100;
const user = () => ({ id: nextUser, role: "user", loginMethod: "email", emailVerified: 1 });
const caller = () => mistakesRouter.createCaller({ req: {} as any, res: {} as any, user: user() as any });

const questions = [
  { id: "q1", question: "Where is most ATP produced in the cell?", type: "multiple-choice", options: ["Nucleus", "Mitochondria", "Golgi"], correctAnswer: "Mitochondria", explanation: "generic" },
  { id: "q2", question: "Name the cycle in the matrix", type: "short-answer", correctAnswer: "Krebs cycle", explanation: "generic" },
];
const quizRow = (extra: Record<string, unknown> = {}) => ({ id: 11, userId: nextUser, recordingId: 4, title: "Cells quiz", questions, ...extra });
const attemptRow = (answers: Record<string, string>) => ({ id: 31, quizId: 11, userId: nextUser, answers, createdAt: new Date() });
const transcript = { recordingId: 4, title: "Cell biology", fullText: "Most ATP is produced in the mitochondria through oxidative phosphorylation. The Krebs cycle runs in the matrix.", segments: null };
const good = { covered: true, explanation: "Most ATP is produced in the mitochondria [1]." };

/** Everything a miss needs: quiz, a wrong attempt, a transcript, no cache hit and an empty attempt. */
function primeMiss(answers: Record<string, string> = { q1: "Nucleus" }, extra: Record<string, any[]> = {}) {
  script = {
    "quizzes:select": [[quizRow()]],
    "quizAttempts:select": [[attemptRow(answers)]],
    "recordings:select": [[transcript]],
    "questionExplanations:select": [[], [{ used: "0" }]],
    ...extra,
  };
}

let clock = 0;
beforeEach(() => {
  nextUser += 1;
  log.length = 0;
  inserted.length = 0;
  script = {};
  failures = {};
  vi.clearAllMocks();
  usage.hasUsage.mockResolvedValue(false);
  usage.assertCanGenerate.mockResolvedValue(undefined);
  usage.recordAiGeneration.mockResolvedValue({ recorded: true });
  ask.loadSourcePassages.mockResolvedValue([]);
  llm.completeJson.mockResolvedValue(good);
});
afterEach(() => vi.restoreAllMocks());

const input = { origin: { quizId: 11 }, questionId: "q1", userAnswer: "ignored by the server" };

describe("who may ask", () => {
  it("answers NOT_FOUND for another person's quiz, pack or session", async () => {
    script = { "quizzes:select": [[quizRow({ userId: 999 })]] };
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    script = { "quizzes:select": [[]] };
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    script = { "examPacks:select": [[]] };
    await expect(caller().explain({ ...input, origin: { packId: 3 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    script = { "practiceSessions:select": [[]] };
    await expect(caller().explain({ ...input, origin: { sessionId: 3 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(llm.completeJson).not.toHaveBeenCalled();
    await expect(caller().list({ origin: { sessionId: 3 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a session that is still open (no hints during a timed run)", async () => {
    script = { "practiceSessions:select": [[{ id: 3, userId: nextUser, submittedAt: null, questions, answers: {}, title: "t" }]] };
    await expect(caller().explain({ ...input, origin: { sessionId: 3 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it("refuses before any attempt exists, and answers an unknown question NOT_FOUND", async () => {
    script = { "quizzes:select": [[quizRow()]], "quizAttempts:select": [[]] };
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    primeMiss();
    await expect(caller().explain({ ...input, questionId: "q99" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to explain a right answer, judging by the stored attempt and not the request", async () => {
    primeMiss({ q1: "mitochondria" });
    await expect(caller().explain({ ...input, userAnswer: "Nucleus" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Nothing to explain/) });
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it("resolves a pack to its latest submitted attempt session", async () => {
    script = {
      "examPacks:select": [[{ id: 3 }]],
      "practiceSessions:select": [[{ id: 8, userId: nextUser, packId: 3, scope: "pack", submittedAt: new Date(), questions, answers: { q1: "Nucleus" }, recordingIds: [4], title: "Pack", courseId: null }]],
      "recordingCourses:select": [[]],
      "recordings:select": [[transcript]],
      "questionExplanations:select": [[], [{ used: "0" }]],
    };
    const result = await caller().explain({ ...input, origin: { packId: 3 } });
    expect(result.status).toBe("ready");
    expect(inserted[0].values.attemptKey).toBe("session:8");
    expect(usage.recordAiGeneration).toHaveBeenCalledWith(nextUser, "explain:session:8");
  });
});

describe("explaining", () => {
  it("writes a grounded explanation, stores it and charges one generation for the attempt", async () => {
    primeMiss();
    const result = await caller().explain(input);
    expect(result).toMatchObject({ status: "ready", cached: false, text: good.explanation });
    expect(result.citations[0]).toMatchObject({ n: 1, recordingId: 4, title: "Cell biology" });
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
    const call = llm.completeJson.mock.calls[0][0];
    expect(call).toMatchObject({ maxTokens: 350, timeoutMs: expect.any(Number) });
    expect(call.timeoutMs).toBeLessThanOrEqual(25_000);
    // The stored attempt's answer, not the request's string, is what the model sees.
    expect(call.messages[1].content).toContain("Student's answer: Nucleus");
    expect(call.messages[1].content).not.toContain("ignored by the server");
    expect(inserted).toHaveLength(1);
    expect(inserted[0].values).toMatchObject({ userId: nextUser, attemptKey: "quiz:31", questionId: "q1", status: "ready", recordingId: 4 });
    expect(inserted[0].values.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(usage.assertCanGenerate).toHaveBeenCalledTimes(1);
    expect(usage.recordAiGeneration).toHaveBeenCalledWith(nextUser, "explain:quiz:31");
  });

  it("does not check the allowance again once the attempt has been charged", async () => {
    usage.hasUsage.mockResolvedValue(true);
    primeMiss();
    await caller().explain(input);
    expect(usage.assertCanGenerate).not.toHaveBeenCalled();
    // The charge call carries the same key, which the ledger dedupes.
    expect(usage.recordAiGeneration).toHaveBeenCalledWith(nextUser, "explain:quiz:31");
  });

  it("returns a cached explanation with no model call, no allowance check and no charge", async () => {
    primeMiss({ q1: "Nucleus" }, { "questionExplanations:select": [[{ status: "ready", text: "Cached text [1].", citations: [{ n: 1, recordingId: 4, title: "Cell biology", start: null, snippet: "s" }] }]] });
    const result = await caller().explain(input);
    expect(result).toMatchObject({ status: "ready", cached: true, text: "Cached text [1]." });
    expect(llm.completeJson).not.toHaveBeenCalled();
    expect(usage.assertCanGenerate).not.toHaveBeenCalled();
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("says not covered with no model call and no charge when nothing in the material matches", async () => {
    primeMiss({ q1: "Nucleus" }, { "recordings:select": [[{ ...transcript, fullText: "A lecture about medieval trade routes and salt." }]] });
    const result = await caller().explain(input);
    expect(result).toEqual({ status: "not_covered", text: null, citations: [], cached: false });
    expect(llm.completeJson).not.toHaveBeenCalled();
    expect(usage.assertCanGenerate).not.toHaveBeenCalled();
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
    expect(inserted[0].values).toMatchObject({ status: "not_covered", text: null });
  });

  it("stores not_covered, uncharged, when the model says the excerpts do not cover it", async () => {
    llm.completeJson.mockResolvedValue({ covered: false, explanation: "" });
    primeMiss();
    const result = await caller().explain(input);
    expect(result.status).toBe("not_covered");
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
    expect(inserted[0].values.status).toBe("not_covered");
  });

  it("retries once on unusable output, then charges a single generation", async () => {
    llm.completeJson.mockResolvedValueOnce({ covered: true, explanation: "No citation here." }).mockResolvedValueOnce(good);
    primeMiss();
    const result = await caller().explain(input);
    expect(result.status).toBe("ready");
    expect(llm.completeJson).toHaveBeenCalledTimes(2);
    expect(usage.recordAiGeneration).toHaveBeenCalledTimes(1);
  });

  it("retries once when the output could not be read, but not when the provider failed", async () => {
    llm.completeJson.mockRejectedValueOnce(Object.assign(new Error("unreadable"), { code: "INTERNAL_SERVER_ERROR" })).mockResolvedValueOnce(good);
    primeMiss();
    await expect(caller().explain(input)).resolves.toMatchObject({ status: "ready" });
    expect(llm.completeJson).toHaveBeenCalledTimes(2);

    llm.completeJson.mockReset();
    llm.completeJson.mockRejectedValue(Object.assign(new Error("Could not create"), { cause: new Error("LLM invoke failed: 429 Too Many") }));
    nextUser += 1;
    primeMiss();
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
    expect(usage.recordAiGeneration).toHaveBeenCalledTimes(1);
  });

  it("fails plainly, with no charge and nothing stored, after two unusable answers", async () => {
    llm.completeJson.mockResolvedValue({ covered: true, explanation: "See https://example.com [1]." });
    primeMiss();
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't explain this one, try again." });
    expect(llm.completeJson).toHaveBeenCalledTimes(2);
    expect(inserted).toHaveLength(0);
    expect(usage.recordAiGeneration).not.toHaveBeenCalled();
  });

  it("only retries with enough of the request's time left, and shrinks the model timeout to fit", async () => {
    const real = Date.now();
    clock = real;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    llm.completeJson.mockImplementationOnce(async () => {
      clock += 46_000; // the first call used most of the budget
      return { covered: true, explanation: "nothing cited" };
    });
    primeMiss();
    await expect(explainMistake(user(), input, real)).rejects.toMatchObject({ message: "Couldn't explain this one, try again." });
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
    expect(EXPLAIN_BUDGET_MS).toBeLessThan(60_000);

    // With 12s left the retry runs, with a timeout that fits.
    llm.completeJson.mockReset();
    llm.completeJson.mockImplementationOnce(async () => {
      clock += 40_000;
      return { covered: true, explanation: "nothing cited" };
    }).mockResolvedValue(good);
    clock = real;
    nextUser += 1;
    primeMiss();
    await explainMistake(user(), input, real);
    expect(llm.completeJson).toHaveBeenCalledTimes(2);
    expect(llm.completeJson.mock.calls[1][0].timeoutMs).toBe(12_000);

    llm.completeJson.mockReset();
    nextUser += 1;
    primeMiss();
    // Already 45s into the request: a model call could not finish, so none is made.
    clock = real + 45_000;
    await expect(explainMistake(user(), input, real)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(llm.completeJson).not.toHaveBeenCalled();

    nextUser += 1;
    primeMiss();
    llm.completeJson.mockResolvedValue(good);
    clock = real + 40_000;
    await explainMistake(user(), input, real);
    expect(llm.completeJson.mock.calls[0][0].timeoutMs).toBe(12_000);
  });
});

describe("limits", () => {
  it("stops at 25 explanations for one attempt without calling the model", async () => {
    primeMiss({ q1: "Nucleus" }, { "questionExplanations:select": [[], [{ used: "25" }]] });
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "CONFLICT", message: EXPLANATION_CAP_MESSAGE });
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it("propagates a monthly usage limit before any model call", async () => {
    usage.assertCanGenerate.mockRejectedValue(Object.assign(new Error("You have used this month's AI generations."), { code: "FORBIDDEN" }));
    primeMiss();
    await expect(caller().explain(input)).rejects.toThrow(/AI generations/);
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it("allows 40 explanations in ten minutes per person", async () => {
    for (let i = 0; i < 40; i++) {
      primeMiss();
      await caller().explain(input);
    }
    primeMiss();
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(llm.completeJson).toHaveBeenCalledTimes(40);
  });

  it("treats a parallel request that wrote the same explanation as a cache hit", async () => {
    primeMiss();
    failures = { "questionExplanations:insert": { code: "ER_DUP_ENTRY", message: "Duplicate entry" } };
    script["questionExplanations:select"] = [[], [{ used: "0" }], [{ status: "ready", text: "Winner [1].", citations: [] }]];
    await expect(caller().explain(input)).resolves.toMatchObject({ cached: true, text: "Winner [1]." });
  });
});

describe("missing tables (migration 0035 not applied)", () => {
  const missing = { code: "ER_NO_SUCH_TABLE", message: "Table 'x.questionExplanations' doesn't exist" };

  it("explains itself on write and lists nothing", async () => {
    primeMiss();
    failures = { "questionExplanations:select": missing };
    await expect(caller().explain(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Mistake explanations are not set up on this server yet." });
    script = { "quizzes:select": [[quizRow()]], "quizAttempts:select": [[attemptRow({})]] };
    await expect(caller().list({ origin: { quizId: 11 } })).resolves.toEqual([]);
  });

  it("deletes and exports without failing", async () => {
    failures = { "questionExplanations:select": missing, "questionExplanations:delete": missing, "recordings:select": missing };
    await expect(deleteExplanationsForRecordings([1])).resolves.toBeUndefined();
    await expect(deleteExplanationsForSources(7, [1])).resolves.toBeUndefined();
    await expect(deleteExplanationsForUser(7)).resolves.toBeUndefined();
    await expect(exportExplanationsForUser(7)).resolves.toEqual([]);
  });
});

describe("list", () => {
  it("finds explanations by the cache key, including one written for an earlier attempt", async () => {
    // Write one under attempt 31 and keep its hash.
    primeMiss();
    await caller().explain(input);
    const written = inserted[0].values;

    // A later attempt (32) of the same question and material: the stored row belongs to attempt 31.
    script = {
      "quizzes:select": [[quizRow()]],
      "quizAttempts:select": [[{ ...attemptRow({ q1: "Nucleus" }), id: 32 }]],
      "recordings:select": [[transcript]],
      "questionExplanations:select": [[
        { inputHash: written.inputHash, attemptKey: "quiz:31", questionId: "q1", status: "ready", text: written.text, citations: written.citations },
        { inputHash: "stale-hash-from-an-edited-transcript", attemptKey: "quiz:32", questionId: "q2", status: "ready", text: "stale", citations: [] },
      ]],
    };
    const rows = await caller().list({ origin: { quizId: 11 } });
    expect(rows).toEqual([{ questionId: "q1", status: "ready", text: written.text, citations: written.citations }]);
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
  });

  it("does not show an explanation after the answer or the material changed", async () => {
    primeMiss();
    await caller().explain(input);
    const written = inserted[0].values;
    script = {
      "quizzes:select": [[quizRow()]],
      "quizAttempts:select": [[attemptRow({ q1: "Golgi" })]],
      "recordings:select": [[transcript]],
      "questionExplanations:select": [[{ ...written, questionId: "q1" }]],
    };
    // The hash differs (another answer), so the row is not matched by the query's key set.
    const rows = await caller().list({ origin: { quizId: 11 } });
    expect(rows).toEqual([]);
  });

  it("is empty before an attempt exists, and when nothing was missed", async () => {
    script = { "quizzes:select": [[quizRow()]], "quizAttempts:select": [[]] };
    await expect(caller().list({ origin: { quizId: 11 } })).resolves.toEqual([]);
    script = { "quizzes:select": [[quizRow()]], "quizAttempts:select": [[attemptRow({ q1: "Mitochondria", q2: "Krebs cycle" })]] };
    await expect(caller().list({ origin: { quizId: 11 } })).resolves.toEqual([]);
  });

  it("is empty, not a raw database error, for a pack or session before migration 0035", async () => {
    const missingSessions = { code: "ER_NO_SUCH_TABLE", message: "Table 'x.practiceSessions' doesn't exist" };
    failures = { "practiceSessions:select": missingSessions };
    script = { "examPacks:select": [[{ id: 3 }]] };
    await expect(caller().list({ origin: { packId: 3 } })).resolves.toEqual([]);
    await expect(caller().list({ origin: { sessionId: 3 } })).resolves.toEqual([]);
    script = { "examPacks:select": [[{ id: 3 }]] };
    await expect(caller().explain({ ...input, origin: { packId: 3 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller().explain({ ...input, origin: { sessionId: 3 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("deletion and export", () => {
  it("removes explanations written for, or quoting, a purged recording", async () => {
    script = {
      "recordings:select": [[{ userId: 7 }]],
      "questionExplanations:select": [[
        { id: 1, recordingId: 4, citations: [] },
        { id: 2, recordingId: 5, citations: [{ n: 1, recordingId: 4, title: "t" }] },
        { id: 3, recordingId: 5, citations: [{ n: 1, recordingId: 5, title: "t" }, { n: 2, recordingId: 0, sourceId: 4 }] },
      ]],
    };
    const deletes: any[] = [];
    const original = fakeDb.delete;
    fakeDb.delete = (table: any) => (deletes.push(getTableName(table)), original(table));
    try {
      await deleteExplanationsForRecordings([4]);
    } finally {
      fakeDb.delete = original;
    }
    expect(deletes).toEqual(["questionExplanations"]);
  });

  it("deletes explanations that cite a removed source, and only those", async () => {
    script = { "questionExplanations:select": [[
      { id: 1, citations: [{ n: 1, recordingId: 0, sourceId: 9, title: "s" }] },
      { id: 2, citations: [{ n: 1, recordingId: 9, title: "recording with the same number" }] },
      { id: 3, citations: [] },
    ]] };
    await deleteExplanationsForSources(7, [9]);
    expect(log).toEqual(["questionExplanations:select", "questionExplanations:delete"]);
    log.length = 0;
    script = { "questionExplanations:select": [[{ id: 2, citations: [{ n: 1, recordingId: 9 }] }]] };
    await deleteExplanationsForSources(7, [9]);
    expect(log).toEqual(["questionExplanations:select"]);
  });

  it("exports text and citations without cache hashes or the owner column", async () => {
    script = { "questionExplanations:select": [[{ id: 1, userId: 7, inputHash: "abc", attemptKey: "quiz:3", questionId: "q1", recordingId: 4, status: "ready", text: "T [1].", citations: [], model: "m", createdAt: new Date() }]] };
    const [row] = await exportExplanationsForUser(7);
    expect(row).not.toHaveProperty("inputHash");
    expect(row).not.toHaveProperty("userId");
    expect(row).toMatchObject({ text: "T [1].", questionId: "q1" });
  });

  it("deletes all of a person's explanations", async () => {
    await deleteExplanationsForUser(7);
    expect(log).toEqual(["questionExplanations:delete"]);
  });
});
