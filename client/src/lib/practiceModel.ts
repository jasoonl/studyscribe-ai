import { formatTimestamp } from "@shared/timestamp";
import type { MessageKey } from "@shared/i18n";
import { citationLink, type AskCitation } from "./askSources";
import { formatLocation } from "./sourceLocation";
import type { ExplainOutput, PracticeStartInput, PracticeOrigin, PracticeQuestion, PracticeResult, StoredExplanation } from "./practiceTypes";

type ErrorLike = { message?: string; data?: { code?: string; usageLimit?: unknown; httpStatus?: number } | null } | null | undefined;

export type PracticeErrorKind = "usageLimit" | "capReached" | "notSetUp" | "tooMany" | "openExam" | "notFound" | "timeout" | "network" | "other";

/**
 * What kind of failure this is, for wording and for whether "Try again" makes sense. Only
 * `data.usageLimit` means the month's allowance is used up; a plain FORBIDDEN is something else.
 */
export function practiceErrorKind(error: unknown): PracticeErrorKind {
  const e = error as ErrorLike;
  if (!e || typeof e !== "object") return "other";
  if (e.data?.usageLimit) return "usageLimit";
  switch (e.data?.code) {
    case "PRECONDITION_FAILED":
      return /not set up/i.test(e.message ?? "") ? "notSetUp" : "openExam";
    case "TOO_MANY_REQUESTS":
      return "tooMany";
    case "CONFLICT":
      // The per-attempt explanation cap. Told apart by its code, never by its message.
      return "capReached";
    case "NOT_FOUND":
      return "notFound";
    case "TIMEOUT":
    case "SERVICE_UNAVAILABLE":
      return "timeout";
    default:
      break;
  }
  if (!e.data) return "network";
  return "other";
}

const ERROR_KEYS: Record<PracticeErrorKind, MessageKey> = {
  usageLimit: "mistakes.error.usageLimit",
  capReached: "mistakes.error.capReached",
  notSetUp: "mistakes.error.notSetUp",
  tooMany: "mistakes.error.tooMany",
  openExam: "mistakes.error.openExam",
  notFound: "mistakes.error.notFound",
  timeout: "mistakes.error.timeout",
  network: "mistakes.error.network",
  other: "mistakes.error.other",
};

/** The message for a failure. The server's own text is never shown for these. */
export function practiceErrorKey(kind: PracticeErrorKind): MessageKey {
  return ERROR_KEYS[kind];
}

/** False when trying again cannot help or would only repeat a refusal. */
export function canRetry(kind: PracticeErrorKind): boolean {
  return kind === "timeout" || kind === "network" || kind === "other" || kind === "tooMany";
}

/** The server says the feature is off (migration not applied) or the question is unreadable. */
export function isNotSet(error: unknown): boolean {
  return practiceErrorKind(error) === "notSetUp";
}

export type Capabilities = { available: boolean; explanations: boolean };

/** What the page may show. Anything but a clear yes from the server counts as off. */
export function capabilitiesFrom(data: Capabilities | undefined, failed: boolean): Capabilities {
  if (failed || !data) return { available: false, explanations: false };
  return { available: data.available === true, explanations: data.available === true && data.explanations === true };
}

export function originKey(origin: PracticeOrigin): string {
  if ("quizId" in origin) return `quiz:${origin.quizId}`;
  if ("packId" in origin) return `pack:${origin.packId}`;
  return `session:${origin.sessionId}`;
}

/** Reads the new fields of a submit response; an old server (no per-question results) gives null. */
export function parseAttempt(data: unknown): { attemptId: number | null; results: PracticeResult[] } | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as { results?: unknown }).results;
  if (!Array.isArray(raw)) return null;
  const results: PracticeResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.correct !== "boolean") continue;
    results.push({
      id: r.id,
      correct: r.correct,
      correctAnswer: typeof r.correctAnswer === "string" ? r.correctAnswer : "",
      userAnswer: typeof r.userAnswer === "string" ? r.userAnswer : "",
      ...(typeof r.recordingId === "number" ? { recordingId: r.recordingId } : {}),
    });
  }
  const attemptId = (data as { attemptId?: unknown }).attemptId;
  return { attemptId: typeof attemptId === "number" ? attemptId : null, results };
}

export type ReviewItem = { question: PracticeQuestion; result: PracticeResult; number: number };

/** The wrong answers, in question order, each with the question's position. */
export function missedItems(questions: readonly PracticeQuestion[], results: readonly PracticeResult[]): ReviewItem[] {
  const byId = new Map(results.map(result => [result.id, result]));
  const items: ReviewItem[] = [];
  questions.forEach((question, index) => {
    const result = byId.get(question.id);
    if (result && !result.correct) items.push({ question, result, number: index + 1 });
  });
  return items;
}

export function correctItems(questions: readonly PracticeQuestion[], results: readonly PracticeResult[]): ReviewItem[] {
  const byId = new Map(results.map(result => [result.id, result]));
  const items: ReviewItem[] = [];
  questions.forEach((question, index) => {
    const result = byId.get(question.id);
    if (result?.correct) items.push({ question, result, number: index + 1 });
  });
  return items;
}

// --- explanation state, one entry per missed question ---

export type ExplainState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string; citations: AskCitation[]; cached: boolean }
  | { status: "notCovered" }
  | { status: "error"; kind: PracticeErrorKind; message: string };

export type ExplainStates = Record<string, ExplainState>;

export type ExplainAction =
  | { type: "load"; id: string }
  | { type: "done"; id: string; output: Pick<ExplainOutput, "status" | "text" | "citations"> & { cached?: boolean } }
  | { type: "fail"; id: string; kind: PracticeErrorKind; message: string }
  | { type: "seed"; stored: readonly StoredExplanation[] };

function fromOutput(output: Pick<ExplainOutput, "status" | "text" | "citations"> & { cached?: boolean }): ExplainState {
  if (output.status === "ready" && output.text && output.text.trim()) {
    return { status: "ready", text: output.text.trim(), citations: output.citations ?? [], cached: output.cached === true };
  }
  // A "ready" answer with no text is not an explanation; the honest answer is "not covered".
  return { status: "notCovered" };
}

export function explainReducer(state: ExplainStates, action: ExplainAction): ExplainStates {
  switch (action.type) {
    case "load":
      return { ...state, [action.id]: { status: "loading" } };
    case "done":
      return { ...state, [action.id]: fromOutput(action.output) };
    case "fail":
      return { ...state, [action.id]: { status: "error", kind: action.kind, message: action.message } };
    case "seed": {
      // Stored explanations fill in only questions the person has not already asked about.
      const next = { ...state };
      for (const item of action.stored) {
        const current = next[item.questionId];
        if (!current || current.status === "idle") next[item.questionId] = fromOutput({ ...item, cached: true });
      }
      return next;
    }
  }
}

/** The next missed question "Explain all" should ask about, or null when there is none. */
export function nextToExplain(items: readonly ReviewItem[], states: ExplainStates, skip: ReadonlySet<string> = new Set()): ReviewItem | null {
  for (const item of items) {
    if (skip.has(item.question.id)) continue;
    const state = states[item.question.id];
    if (!state || state.status === "idle" || (state.status === "error" && canRetry(state.kind))) return item;
  }
  return null;
}

/** Explain all should stop here: another request would only be refused again. */
export function stopsExplainAll(kind: PracticeErrorKind): boolean {
  return kind === "usageLimit" || kind === "capReached" || kind === "notSetUp" || kind === "tooMany" || kind === "notFound" || kind === "openExam";
}

// --- citations ---

export type CitationView = { n: number; href: string; kind: "recording" | "source"; title: string; where: string; snippet: string };

type Translate = (key: "sources.location.page" | "sources.location.slide" | "sources.location.section" | "sources.location.cont", vars?: Record<string, string | number>) => string;

/** One chip: "Lecture 3, 12:40" opens the recording at that time; "Slides, Page 7" opens the source page. */
export function citationView(citation: AskCitation, t: Translate): CitationView {
  const isSource = Boolean(citation.sourceId);
  return {
    n: citation.n,
    href: citationLink(citation),
    kind: isSource ? "source" : "recording",
    title: citation.title,
    where: isSource ? formatLocation(citation.location, t) : formatTimestamp(citation.start),
    snippet: citation.snippet,
  };
}

// --- answers ---

export function answeredCount(questions: readonly PracticeQuestion[], answers: Record<string, string>): number {
  return questions.filter(question => (answers[question.id] ?? "").trim() !== "").length;
}

/** The saved answers from the server with whatever was typed on this device on top. */
export function mergeDraft(server: Record<string, string>, local: Record<string, string> | null): Record<string, string> {
  return { ...server, ...(local ?? {}) };
}

export function sameAnswers(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(key => a[key] === b[key]);
}

/** Keeps only answers to questions in the exam, so a stale draft cannot add unknown ids. */
export function pruneAnswers(questions: readonly PracticeQuestion[], answers: Record<string, string>): Record<string, string> {
  const ids = new Set(questions.map(question => question.id));
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(answers)) if (ids.has(id) && typeof value === "string") out[id] = value.slice(0, 2000);
  return out;
}

export { DRAFT_PREFIX, draftKey, readDraft, writeDraft, clearDraft, clearAllPracticeDrafts } from "./practiceDrafts";
import { type StorageLike, safeStorage } from "./practiceDrafts";
export const TIMER_HIDDEN_KEY = "studyscribe_exam_timer_hidden";

export function readTimerHidden(storage: StorageLike | null = safeStorage()): boolean {
  try {
    return storage?.getItem(TIMER_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTimerHidden(hidden: boolean, storage: StorageLike | null = safeStorage()) {
  try {
    if (hidden) storage?.setItem(TIMER_HIDDEN_KEY, "1");
    else storage?.removeItem(TIMER_HIDDEN_KEY);
  } catch {
    // The choice then lasts for this visit only.
  }
}

// --- starting an exam ---

export function practicePath(sessionId: number): string {
  return `/practice/${sessionId}`;
}

/** Sessions that are still open, for "Continue" on the practice page. */
export function openSessions<T extends { submittedAt: Date | string | null }>(items: readonly T[]): T[] {
  return items.filter(item => item.submittedAt === null);
}

/** Where a practice start button sends people who cannot start one yet. */
export function startInput(
  scope: "quiz" | "pack" | "course",
  target: { quizId?: number; packId?: number; courseId?: number },
  settings: { mode: "timed" | "review"; minutes?: number; questionCount?: number; extraTime: number },
): PracticeStartInput {
  return {
    scope,
    ...(scope === "quiz" ? { quizId: target.quizId } : {}),
    ...(scope === "pack" ? { packId: target.packId } : {}),
    ...(scope === "course" ? { courseId: target.courseId, ...(settings.questionCount ? { questionCount: settings.questionCount } : {}) } : {}),
    mode: settings.mode,
    ...(settings.mode === "timed" && settings.minutes ? { minutes: settings.minutes } : {}),
    ...(settings.mode === "timed" && settings.extraTime > 1 ? { extraTime: settings.extraTime as 1.25 | 1.5 } : {}),
  };
}

const START_ERROR_KEYS: Record<PracticeErrorKind, MessageKey> = {
  usageLimit: "practice.error.other",
  capReached: "practice.error.other",
  notSetUp: "practice.error.notSetUp",
  tooMany: "practice.error.tooMany",
  openExam: "practice.error.noQuestions",
  notFound: "practice.error.notFound",
  timeout: "practice.error.other",
  network: "practice.error.network",
  other: "practice.error.other",
};

/** The message when an exam could not be started. */
export function startErrorKey(kind: PracticeErrorKind): MessageKey {
  return START_ERROR_KEYS[kind];
}
