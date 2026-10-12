/**
 * Pure parts of the exam pack (C8): which transcript text goes to the model,
 * the prompts, and checking what comes back. No database, no network.
 */
import { EXAM_PACK_BUDGET, allocateBudget, condenseTranscript, type BudgetSegment } from "./transcriptBudget";

export const MAX_PACK_RECORDINGS = 12;
export const PACK_QUESTION_COUNT = 15;

type ChatMessage = { role: "system" | "user"; content: string };

export type PackSourceInput = {
  recordingId: number;
  title: string;
  createdAt: Date | string;
  fullText: string;
  segments: BudgetSegment[] | null;
};

export type PackSource = { n: number; recordingId: number; title: string; text: string };

/**
 * Numbers the recordings oldest first (the order they were taught) and gives
 * each a share of one combined budget, so ten lectures cost no more time than
 * a single long one.
 */
export function buildPackSources(inputs: PackSourceInput[], budget = EXAM_PACK_BUDGET): PackSource[] {
  const ordered = [...inputs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  // Allow for the "[m:ss] " prefixes the condensed text adds.
  const shares = allocateBudget(ordered.map(input => Math.ceil(input.fullText.length * 1.15) + 200), budget);
  return ordered.map((input, index) => ({
    n: index + 1,
    recordingId: input.recordingId,
    title: input.title,
    text: condenseTranscript({ segments: input.segments, fullText: input.fullText }, Math.max(1_000, shares[index])).text,
  }));
}

function sourcesBlock(sources: PackSource[]): string {
  return sources.map(source => `=== Recording ${source.n}: ${source.title} ===\n${source.text}`).join("\n\n");
}

export function buildGuideMessages(input: { title: string; sources: PackSource[]; meeting: boolean }): ChatMessage[] {
  const unit = input.meeting ? "meetings" : "lectures";
  return [
    {
      role: "system",
      content: [
        `You write one revision guide that covers several ${unit} together, for someone preparing for an exam on all of them.`,
        "Organise by topic, not by recording: bring together what different recordings say about the same idea, and say which recording each point comes from as (Rec 2) or (Rec 1, 3).",
        "Use Markdown with these sections: ## Overview (three or four sentences on what the material covers and how the parts connect), ## Topics (a ### heading per topic with the key points as bullets), ## Key Terms (term: short definition), ## Formulas and Rules (only if there are any), ## Likely Exam Questions (six to ten, mixing recall and explanation), ## Revision Checklist (a checklist of what to be able to do).",
        "Only use what the transcripts support. Do not invent facts, dates or formulas. Write in the language of the transcripts.",
      ].join(" "),
    },
    { role: "user", content: `Pack: ${input.title}\n\n${sourcesBlock(input.sources)}` },
  ];
}

export const PACK_QUIZ_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "exam_pack_quiz",
    strict: true,
    schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              type: { type: "string", enum: ["multiple-choice", "short-answer"] },
              options: { type: "array", items: { type: "string" } },
              correctAnswer: { type: "string" },
              explanation: { type: "string" },
              source: { type: "number" },
            },
            required: ["question", "type", "options", "correctAnswer", "explanation", "source"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
};

export function buildQuizMessages(input: { title: string; sources: PackSource[]; count?: number }): ChatMessage[] {
  const count = input.count ?? PACK_QUESTION_COUNT;
  return [
    {
      role: "system",
      content: [
        `Write a ${count}-question practice exam covering all of the recordings below, spread across them roughly in proportion to how much each covers.`,
        "About four in five are multiple-choice with exactly four options and one correct answer; the rest are short-answer with a correct answer of a few words.",
        "correctAnswer must be copied exactly from options for multiple-choice questions; options is an empty list for short-answer questions.",
        "explanation says in one or two sentences why the answer is right. source is the number of the recording the question is based on.",
        "Test understanding, not trivia about who said what. Only use what the transcripts support. Write in the language of the transcripts.",
      ].join(" "),
    },
    { role: "user", content: `Pack: ${input.title}\n\n${sourcesBlock(input.sources)}` },
  ];
}

export type PackQuestion = {
  id: string;
  question: string;
  type: "multiple-choice" | "short-answer";
  options?: string[];
  correctAnswer: string;
  explanation: string;
  recordingId?: number;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Drops malformed questions: a multiple-choice question needs two or more
 * distinct options with the answer among them (casing is fixed to match the
 * option), a short-answer question needs an answer.
 */
export function normalizeQuizQuestions(raw: unknown, sources: PackSource[]): PackQuestion[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { questions?: unknown }).questions : null;
  if (!Array.isArray(list)) return [];
  const bySource = new Map(sources.map(source => [source.n, source.recordingId]));
  const result: PackQuestion[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const question = clean(item.question, 600);
    const answer = clean(item.correctAnswer, 300);
    if (!question || !answer || seen.has(question.toLowerCase())) continue;
    const recordingId = bySource.get(Number(item.source));
    const explanation = clean(item.explanation, 800);

    const rawOptions = Array.isArray(item.options) ? item.options.map(option => clean(option, 300)).filter(Boolean) : [];
    const options = rawOptions.filter((option, index) => rawOptions.findIndex(other => other.toLowerCase() === option.toLowerCase()) === index);
    const wantsChoice = item.type === "multiple-choice" || (item.type !== "short-answer" && options.length >= 2);

    let built: PackQuestion | null = null;
    if (wantsChoice) {
      const match = options.find(option => option.toLowerCase() === answer.toLowerCase());
      if (options.length >= 2 && match) {
        built = { id: "", question, type: "multiple-choice", options: options.slice(0, 6), correctAnswer: match, explanation };
        if (!built.options!.includes(match)) built.options = [...built.options!.slice(0, 5), match];
      }
    } else {
      built = { id: "", question, type: "short-answer", correctAnswer: answer, explanation };
    }
    if (!built) continue;
    seen.add(question.toLowerCase());
    result.push({ ...built, id: `q${result.length + 1}`, ...(recordingId ? { recordingId } : {}) });
    if (result.length >= 30) break;
  }
  return result;
}

/** Whitespace and punctuation, including typographic quotes and dashes. */
export const PUNCTUATION = /[\s.,;:!?¡¿()[\]{}"'“”‘’«»`´\-‐–—/\\|<>=+*&^%$#@~_…·]+/g;

const ARTICLES = new Set(["a", "an", "the", "le", "la", "les", "el", "los", "las", "der", "die", "das"]);

export function normalizeAnswer(value: string): string {
  const words = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]+/g, "")
    .replace(PUNCTUATION, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const meaningful = words.filter(word => !ARTICLES.has(word));
  return (meaningful.length ? meaningful : words).join(" ");
}

/**
 * Multiple choice must match the option. A short answer counts when it says
 * the same thing ignoring case, accents, punctuation and articles, or when it
 * contains a short model answer whole ("photosynthesis" in "it is photosynthesis").
 */
export function isAnswerCorrect(question: Pick<PackQuestion, "type" | "correctAnswer">, given: string | undefined): boolean {
  if (!given?.trim()) return false;
  if (question.type === "multiple-choice") return given.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
  const expected = normalizeAnswer(question.correctAnswer);
  const actual = normalizeAnswer(given);
  if (!expected || !actual) return false;
  if (actual === expected) return true;
  return expected.split(" ").length <= 4 && ` ${actual} `.includes(` ${expected} `);
}

export function scoreQuiz(questions: PackQuestion[], answers: Record<string, string>) {
  const results = questions.map(question => ({ id: question.id, correct: isAnswerCorrect(question, answers[question.id]) }));
  const correct = results.filter(result => result.correct).length;
  return { correct, total: questions.length, score: questions.length ? Math.round((correct / questions.length) * 100) : 0, results };
}

export function defaultPackTitle(courseName: string | null, recordingCount: number, today: Date): string {
  const when = today.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return courseName ? `${courseName} exam pack` : `Exam pack: ${recordingCount} recordings, ${when}`;
}
