import { describe, expect, it } from "vitest";
import {
  answeredCount, canRetry, capabilitiesFrom, citationView, clearAllPracticeDrafts, clearDraft, correctItems, draftKey, explainReducer, mergeDraft, missedItems, nextToExplain, openSessions, originKey,
  parseAttempt, practiceErrorKey, practiceErrorKind, pruneAnswers, readDraft, readTimerHidden, sameAnswers, startErrorKey, startInput, stopsExplainAll, writeDraft, writeTimerHidden,
  type ExplainStates,
} from "./practiceModel";
import type { PracticeQuestion, PracticeResult } from "./practiceTypes";

const err = (code?: string, extra: Record<string, unknown> = {}, message = "x") => ({ message, data: code ? { code, ...extra } : null });

const questions: PracticeQuestion[] = [
  { id: "q1", question: "One?", type: "short-answer" },
  { id: "q2", question: "Two?", type: "multiple-choice", options: ["a", "b"] },
  { id: "q3", question: "Three?", type: "short-answer" },
];
const results: PracticeResult[] = [
  { id: "q1", correct: true, correctAnswer: "x", userAnswer: "x" },
  { id: "q2", correct: false, correctAnswer: "a", userAnswer: "b" },
  { id: "q3", correct: false, correctAnswer: "z", userAnswer: "" },
];

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("error mapping", () => {
  it("tells the per-attempt explanation cap (CONFLICT) from the rate limit, by code only", () => {
    expect(practiceErrorKind(err("CONFLICT", {}, "anything at all"))).toBe("capReached");
    expect(practiceErrorKind(err("TOO_MANY_REQUESTS", {}, "as many explanations as one attempt can have"))).toBe("tooMany");
    expect(canRetry("capReached")).toBe(false);
    expect(stopsExplainAll("capReached")).toBe(true);
    expect(practiceErrorKey("capReached")).toBe("mistakes.error.capReached");
  });
  it("treats only data.usageLimit as the monthly allowance", () => {
    expect(practiceErrorKind(err("FORBIDDEN", { usageLimit: { kind: "ai_generation", upgradeAvailable: true } }))).toBe("usageLimit");
    expect(practiceErrorKind(err("FORBIDDEN"))).toBe("other");
  });
  it("tells a feature that is off from an open exam", () => {
    expect(practiceErrorKind(err("PRECONDITION_FAILED", {}, "Practice exams are not set up on this server yet."))).toBe("notSetUp");
    expect(practiceErrorKind(err("PRECONDITION_FAILED", {}, "Finish the practice first."))).toBe("openExam");
  });
  it("maps rate limits, missing items, timeouts and dropped connections", () => {
    expect(practiceErrorKind(err("TOO_MANY_REQUESTS"))).toBe("tooMany");
    expect(practiceErrorKind(err("NOT_FOUND"))).toBe("notFound");
    expect(practiceErrorKind(err("TIMEOUT"))).toBe("timeout");
    expect(practiceErrorKind(err(undefined))).toBe("network");
    expect(practiceErrorKind(null)).toBe("other");
    expect(practiceErrorKind("boom")).toBe("other");
  });
  it("offers Try again only where trying again can help", () => {
    for (const kind of ["usageLimit", "capReached", "notSetUp", "openExam", "notFound"] as const) expect(canRetry(kind)).toBe(false);
    for (const kind of ["timeout", "network", "other", "tooMany"] as const) expect(canRetry(kind)).toBe(true);
  });
  it("stops Explain all where the next request would be refused too", () => {
    expect(stopsExplainAll("usageLimit")).toBe(true);
    expect(stopsExplainAll("tooMany")).toBe(true);
    expect(stopsExplainAll("timeout")).toBe(false);
  });
  it("has a message for every kind", () => {
    for (const kind of ["usageLimit", "capReached", "notSetUp", "tooMany", "openExam", "notFound", "timeout", "network", "other"] as const) {
      expect(practiceErrorKey(kind)).toMatch(/^mistakes\.error\./);
      expect(startErrorKey(kind)).toMatch(/^practice\.error\./);
    }
  });
});

describe("capabilities", () => {
  it("hides everything unless the server clearly says yes", () => {
    expect(capabilitiesFrom(undefined, false)).toEqual({ available: false, explanations: false });
    expect(capabilitiesFrom({ available: true, explanations: true }, true)).toEqual({ available: false, explanations: false });
    expect(capabilitiesFrom({ available: false, explanations: true }, false)).toEqual({ available: false, explanations: false });
    expect(capabilitiesFrom({ available: true, explanations: false }, false)).toEqual({ available: true, explanations: false });
    expect(capabilitiesFrom({ available: true, explanations: true }, false)).toEqual({ available: true, explanations: true });
  });
});

describe("attempt results", () => {
  it("reads per-question results and the attempt id", () => {
    const parsed = parseAttempt({ score: 33, attemptId: 9, results: [{ id: "q1", correct: false, correctAnswer: "a", userAnswer: "b", recordingId: 4 }, { id: 5 }, null] });
    expect(parsed).toEqual({ attemptId: 9, results: [{ id: "q1", correct: false, correctAnswer: "a", userAnswer: "b", recordingId: 4 }] });
  });
  it("gives null for an older server that sends no per-question results", () => {
    expect(parseAttempt({ score: 50, correct: 1, total: 2 })).toBeNull();
    expect(parseAttempt(null)).toBeNull();
  });
  it("keeps results that lack the new fields", () => {
    expect(parseAttempt({ results: [{ id: "q1", correct: true }] })).toEqual({ attemptId: null, results: [{ id: "q1", correct: true, correctAnswer: "", userAnswer: "" }] });
  });
  it("lists wrong and right answers in question order with their numbers", () => {
    expect(missedItems(questions, results).map(item => [item.question.id, item.number])).toEqual([["q2", 2], ["q3", 3]]);
    expect(correctItems(questions, results).map(item => item.number)).toEqual([1]);
    expect(missedItems(questions, [])).toEqual([]);
  });
});

describe("explanation state", () => {
  const items = missedItems(questions, results);
  it("shows a stored explanation and keeps what the person already asked for", () => {
    let states: ExplainStates = explainReducer({}, { type: "load", id: "q2" });
    states = explainReducer(states, {
      type: "seed",
      stored: [
        { questionId: "q2", status: "ready", text: "Old", citations: [] },
        { questionId: "q3", status: "ready", text: "Because.", citations: [] },
      ],
    });
    expect(states.q2.status).toBe("loading");
    expect(states.q3).toMatchObject({ status: "ready", text: "Because.", cached: true });
  });
  it("is honest when the materials do not cover the question", () => {
    expect(explainReducer({}, { type: "done", id: "q2", output: { status: "not_covered", text: null, citations: [] } }).q2).toEqual({ status: "notCovered" });
    expect(explainReducer({}, { type: "done", id: "q2", output: { status: "ready", text: "  ", citations: [] } }).q2).toEqual({ status: "notCovered" });
  });
  it("records a failure with its kind", () => {
    expect(explainReducer({}, { type: "fail", id: "q2", kind: "timeout", message: "" }).q2).toMatchObject({ status: "error", kind: "timeout" });
  });
  it("picks the next question to explain, skipping ones tried this run so a failure cannot loop", () => {
    let states: ExplainStates = {};
    expect(nextToExplain(items, states)?.question.id).toBe("q2");
    states = explainReducer(states, { type: "done", id: "q2", output: { status: "ready", text: "Ok", citations: [] } });
    expect(nextToExplain(items, states)?.question.id).toBe("q3");
    states = explainReducer(states, { type: "fail", id: "q3", kind: "timeout", message: "" });
    expect(nextToExplain(items, states)?.question.id).toBe("q3");
    expect(nextToExplain(items, states, new Set(["q3"]))).toBeNull();
    states = explainReducer(states, { type: "fail", id: "q3", kind: "usageLimit", message: "" });
    expect(nextToExplain(items, states)).toBeNull();
  });
});

describe("citation links", () => {
  const t = (key: string, vars?: Record<string, string | number>) => (key.endsWith("page") ? `Page ${vars?.n}` : key);
  it("opens a recording at the cited time", () => {
    const view = citationView({ n: 1, recordingId: 7, title: "Lecture 3", start: 760.4, snippet: "x" }, t);
    expect(view).toMatchObject({ kind: "recording", href: "/recording/7?t=760", where: "12:40" });
  });
  it("opens a recording from the start when the time is unknown", () => {
    expect(citationView({ n: 1, recordingId: 7, title: "L", start: null, snippet: "" }, t).href).toBe("/recording/7");
  });
  it("opens a source page with the quoted words highlighted", () => {
    const view = citationView({ n: 2, recordingId: 0, title: "Slides", start: null, snippet: "…the Krebs cycle makes ATP…", sourceId: 12, location: "Page 7", unitIndex: 6 }, t);
    expect(view.kind).toBe("source");
    expect(view.where).toBe("Page 7");
    const url = new URL(view.href, "http://x");
    expect(url.pathname).toBe("/sources/12");
    expect(url.searchParams.get("tab")).toBe("pages");
    expect(url.searchParams.get("page")).toBe("7");
    expect(url.searchParams.get("q")).toBe("the Krebs cycle makes ATP");
  });
});

describe("answers and drafts", () => {
  it("counts only non-blank answers", () => {
    expect(answeredCount(questions, { q1: "a", q2: "  ", q3: "" })).toBe(1);
  });
  it("lets what was typed on this device win over the saved copy", () => {
    expect(mergeDraft({ q1: "old", q2: "b" }, { q1: "new" })).toEqual({ q1: "new", q2: "b" });
    expect(mergeDraft({ q1: "old" }, null)).toEqual({ q1: "old" });
  });
  it("compares and prunes answers", () => {
    expect(sameAnswers({ a: "1" }, { a: "1" })).toBe(true);
    expect(sameAnswers({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameAnswers({ a: "1" }, { a: "1", b: "" })).toBe(false);
    expect(pruneAnswers(questions, { q1: "x", zzz: "y", q2: 5 as unknown as string })).toEqual({ q1: "x" });
  });
  it("saves, reads and clears a draft, and survives broken storage", () => {
    const storage = memoryStorage();
    expect(readDraft(4, storage)).toBeNull();
    writeDraft(4, { q1: "x" }, storage);
    expect(storage.getItem(draftKey(4))).toBe('{"q1":"x"}');
    expect(readDraft(4, storage)).toEqual({ q1: "x" });
    storage.setItem(draftKey(5), "not json");
    expect(readDraft(5, storage)).toBeNull();
    storage.setItem(draftKey(6), "[1]");
    expect(readDraft(6, storage)).toBeNull();
    clearDraft(4, storage);
    expect(readDraft(4, storage)).toBeNull();
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    expect(readDraft(1, broken)).toBeNull();
    expect(() => writeDraft(1, {}, broken)).not.toThrow();
    expect(() => clearDraft(1, broken)).not.toThrow();
  });
  it("removes every practice draft on sign-out and nothing else", () => {
    const map = new Map<string, string>([[draftKey(1), "{}"], [draftKey(2), "{}"], ["studyscribe_ui_language", "es"]]);
    const storage = {
      get length() { return map.size; },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    clearAllPracticeDrafts(storage);
    expect(Array.from(map.keys())).toEqual(["studyscribe_ui_language"]);
    expect(() => clearAllPracticeDrafts(null)).not.toThrow();
  });
  it("remembers whether the timer is hidden", () => {
    const storage = memoryStorage();
    expect(readTimerHidden(storage)).toBe(false);
    writeTimerHidden(true, storage);
    expect(readTimerHidden(storage)).toBe(true);
    writeTimerHidden(false, storage);
    expect(readTimerHidden(storage)).toBe(false);
  });
});

describe("starting an exam", () => {
  it("builds the request for each scope", () => {
    expect(startInput("quiz", { quizId: 3 }, { mode: "timed", minutes: 15, extraTime: 1 })).toEqual({ scope: "quiz", quizId: 3, mode: "timed", minutes: 15 });
    expect(startInput("pack", { packId: 2 }, { mode: "timed", minutes: 20, extraTime: 1.25 })).toEqual({ scope: "pack", packId: 2, mode: "timed", minutes: 20, extraTime: 1.25 });
    expect(startInput("course", { courseId: 5 }, { mode: "review", minutes: 20, questionCount: 12, extraTime: 1.5 })).toEqual({ scope: "course", courseId: 5, questionCount: 12, mode: "review" });
  });
  it("tells open sessions from finished ones and names origins", () => {
    expect(openSessions([{ submittedAt: null }, { submittedAt: new Date() }])).toHaveLength(1);
    expect([originKey({ quizId: 1 }), originKey({ packId: 2 }), originKey({ sessionId: 3 })]).toEqual(["quiz:1", "pack:2", "session:3"]);
  });
});
