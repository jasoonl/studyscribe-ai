import { trpc } from "./trpc";
import type { AskCitation } from "./askSources";

/** The shapes of the practice and mistakes API (plan section 5), as the screens use them. */
export type PracticeOrigin = { quizId: number } | { packId: number } | { sessionId: number };

export type PracticeQuestion = {
  id: string;
  question: string;
  type: "multiple-choice" | "short-answer";
  options?: string[];
  recordingId?: number;
};

export type PracticeResult = {
  id: string;
  correct: boolean;
  correctAnswer: string;
  userAnswer: string;
  recordingId?: number;
};

export type PracticeOutcome = {
  score: number;
  correct: number;
  total: number;
  results: PracticeResult[];
  autoSubmitted: boolean;
  secondsUsed: number;
};

export type PracticeSessionData = {
  id: number;
  mode: "review" | "timed";
  scope: "quiz" | "pack" | "course" | "missed";
  title: string;
  status: "open" | "submitted";
  questions: PracticeQuestion[];
  answers: Record<string, string>;
  deadlineAt: Date | null;
  serverNow: Date;
  timeLimitSeconds: number | null;
  extraTime?: number | null;
  result?: PracticeOutcome;
};

export type StoredExplanation = {
  questionId: string;
  status: "ready" | "not_covered";
  text: string | null;
  citations: AskCitation[];
};

export type ExplainOutput = { status: "ready" | "not_covered"; text: string | null; citations: AskCitation[]; cached: boolean };

export type PracticeStartInput = {
  scope: "quiz" | "pack" | "course";
  quizId?: number;
  packId?: number;
  courseId?: number;
  mode: "timed" | "review";
  questionCount?: number;
  minutes?: number;
  extraTime?: 1 | 1.25 | 1.5;
};

export type PracticeListItem = {
  id: number;
  title: string;
  scope: "quiz" | "pack" | "course" | "missed";
  mode: "review" | "timed";
  score: number | null;
  submittedAt: Date | null;
};

/** The practice and mistakes procedures, typed by the server's router. */
export const practiceApi = trpc;
