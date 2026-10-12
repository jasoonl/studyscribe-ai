/**
 * Prompts and output validation for the transcript extractions that are
 * stored as structured data: tasks and deadlines (C3), key terms (B6) and
 * chapters (B8). Pure: no database, no network, so the tests can cover what
 * the model is allowed to put in front of a student.
 */
import { ACTION_ITEM_KINDS, MAX_ACTION_ITEM_TEXT, isIsoDate, type ActionItemKind } from "@shared/actionItems";

type ChatMessage = { role: "system" | "user"; content: string };

/** Model output is JSON, sometimes wrapped in a Markdown code fence anyway. */
export function parseJsonContent(content: unknown): unknown {
  if (typeof content !== "string") return null;
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function asArray(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) {
    return (value as Record<string, unknown[]>)[key];
  }
  return [];
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

export function seconds(value: unknown, duration: number | null): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0) return null;
  if (duration && duration > 0 && number > duration + 5) return null;
  return Math.floor(number);
}

/* ------------------------------------------------------------------ */
/* Tasks, assignments and deadlines                                    */
/* ------------------------------------------------------------------ */

export const MAX_ACTION_ITEMS = 25;

export const ACTION_ITEMS_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "action_items",
    strict: true,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              kind: { type: "string", enum: [...ACTION_ITEM_KINDS] },
              owner: { type: ["string", "null"] },
              dueDate: { type: ["string", "null"] },
              dueText: { type: ["string", "null"] },
              atSeconds: { type: ["number", "null"] },
            },
            required: ["text", "kind", "owner", "dueDate", "dueText", "atSeconds"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
};

export function buildActionItemsMessages(input: {
  title: string;
  audience: string | null;
  recordedOn: string;
  transcript: string;
  timestamped: boolean;
}): ChatMessage[] {
  const meeting = input.audience === "professional";
  return [
    {
      role: "system",
      content: [
        `You find the things someone has to do after a ${meeting ? "meeting" : "lecture or class"}: ${meeting ? "tasks people agreed to do, follow-ups and deadlines" : "homework, assignments, problem sets, essays, readings, upcoming exams or tests, and anything the lecturer said to prepare"}.`,
        "Only include what the transcript actually says has to be done. Do not invent tasks, owners or dates. General advice (\"review your notes\") is not a task unless it was set as work.",
        `The recording was made on ${input.recordedOn} (YYYY-MM-DD). Turn relative dates such as "next Friday" or "in two weeks" into a date counted from that day, and keep the words that were said in dueText. When no day is stated, dueDate and dueText are null.`,
        "kind is assignment (work to hand in), exam (exam, test or quiz), reading (something to read or watch) or task (anything else).",
        "owner is the person responsible when the transcript names one, otherwise null.",
        input.timestamped
          ? "Lines start with [m:ss]. atSeconds is when the item was mentioned, in seconds from the start (for example [12:05] is 725)."
          : "There are no timestamps, so atSeconds is null.",
        "Write each item as a short instruction (\"Submit lab report 3\"), at most 20 words, in the transcript's language. If nothing has to be done, return an empty list.",
      ].join(" "),
    },
    { role: "user", content: `Recording: ${input.title}\n\nTranscript:\n${input.transcript}` },
  ];
}

export type ExtractedActionItem = {
  text: string;
  kind: ActionItemKind;
  owner: string | null;
  dueDate: string | null;
  dueText: string | null;
  atSeconds: number | null;
};

/** A key that matches the same task written slightly differently. */
export function actionItemKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,;:!?¡¿()[\]{}"'“”‘’«»`´\-‐–—/\\|<>=+*&^%$#@~_…·]+/g, " ")
    .trim();
}

/**
 * Validates the model's list: drops empty or duplicate items, keeps only real
 * dates within a sensible range of the recording (a "due date" ten years out
 * is a misread), and clamps timestamps to the recording.
 */
export function normalizeExtractedActionItems(
  raw: unknown,
  options: { recordedOn: string; durationSeconds: number | null },
): ExtractedActionItem[] {
  const seen = new Set<string>();
  const result: ExtractedActionItem[] = [];
  const [year] = options.recordedOn.split("-").map(Number);
  for (const entry of asArray(raw, "items")) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const text = cleanText(item.text, MAX_ACTION_ITEM_TEXT);
    if (text.length < 3) continue;
    const key = actionItemKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const kind = ACTION_ITEM_KINDS.includes(item.kind as ActionItemKind) ? (item.kind as ActionItemKind) : "task";
    let dueDate = isIsoDate(item.dueDate) ? (item.dueDate as string) : null;
    if (dueDate) {
      const dueYear = Number(dueDate.slice(0, 4));
      if (dueYear < year - 1 || dueYear > year + 2) dueDate = null;
    }
    result.push({
      text,
      kind,
      owner: cleanText(item.owner, 120) || null,
      dueDate,
      dueText: cleanText(item.dueText, 120) || null,
      atSeconds: seconds(item.atSeconds, options.durationSeconds),
    });
    if (result.length >= MAX_ACTION_ITEMS) break;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Key terms                                                           */
/* ------------------------------------------------------------------ */

export const MAX_KEY_TERMS = 15;

export const KEY_TERMS_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "key_terms",
    strict: true,
    schema: {
      type: "object",
      properties: { terms: { type: "array", items: { type: "string" } } },
      required: ["terms"],
      additionalProperties: false,
    },
  },
};

export function buildKeyTermsMessages(input: { title: string; transcript: string }): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "List the 8 to 15 most important terms in this transcript: names of concepts, technical vocabulary, people, places, theories, formulas. " +
        "Copy each term exactly as it is written in the transcript (same spelling, same language) so it can be searched for. One to four words each. " +
        "Leave out filler and generic words such as \"lecture\", \"today\" or \"example\". Most important first.",
    },
    { role: "user", content: `Recording: ${input.title}\n\nTranscript:\n${input.transcript}` },
  ];
}

/**
 * Keeps only terms that occur in the transcript, since each chip is a search
 * of the transcript and a chip that finds nothing is worse than no chip.
 */
export function normalizeKeyTerms(raw: unknown, fullText: string): string[] {
  const haystack = fullText.toLowerCase();
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of asArray(raw, "terms")) {
    const term = cleanText(entry, 60).replace(/^["'“”‘’]+|["'“”‘’.,;:]+$/g, "");
    if (term.length < 2 || term.split(" ").length > 5) continue;
    const lower = term.toLowerCase();
    if (seen.has(lower) || !haystack.includes(lower)) continue;
    seen.add(lower);
    terms.push(term);
    if (terms.length >= MAX_KEY_TERMS) break;
  }
  return terms;
}

/** How often each term occurs, so chips can show a count. */
export function countOccurrences(terms: string[], fullText: string): Record<string, number> {
  const haystack = fullText.toLowerCase();
  const counts: Record<string, number> = {};
  for (const term of terms) {
    const needle = term.toLowerCase();
    let count = 0;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count++;
    counts[term] = count;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Chapters                                                            */
/* ------------------------------------------------------------------ */

export const MAX_CHAPTERS = 20;
/** Chapters closer together than this are merged; a 15-second chapter is noise. */
const MIN_CHAPTER_GAP_SECONDS = 30;

export const CHAPTERS_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "chapters",
    strict: true,
    schema: {
      type: "object",
      properties: {
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              start: { type: "number" },
              title: { type: "string" },
              summary: { type: "string" },
            },
            required: ["start", "title", "summary"],
            additionalProperties: false,
          },
        },
      },
      required: ["chapters"],
      additionalProperties: false,
    },
  },
};

export function suggestedChapterCount(durationSeconds: number | null): number {
  if (!durationSeconds || durationSeconds <= 0) return 6;
  return Math.max(2, Math.min(12, Math.round(durationSeconds / 420)));
}

export function buildChaptersMessages(input: { title: string; transcript: string; durationSeconds: number | null }): ChatMessage[] {
  const count = suggestedChapterCount(input.durationSeconds);
  return [
    {
      role: "system",
      content:
        `Split this recording into about ${count} chapters, one per topic, in order. Each line of the transcript starts with [m:ss] or [h:mm:ss]. ` +
        "start is the second the topic begins, read from those timestamps (for example [12:05] is 725); the first chapter starts at 0. " +
        "title is a short heading of at most 8 words naming the topic (not \"Introduction part 2\"). summary is one sentence on what is covered. " +
        "Write in the transcript's language.",
    },
    { role: "user", content: `Recording: ${input.title}\n\nTranscript:\n${input.transcript}` },
  ];
}

export type Chapter = { start: number; title: string; summary: string };

/**
 * Sorts chapters, drops ones outside the recording or with no title, merges
 * ones that start almost together, and makes the first one start at 0 so the
 * outline covers the opening minutes.
 */
export function normalizeChapters(raw: unknown, durationSeconds: number | null): Chapter[] {
  const candidates: Chapter[] = [];
  for (const entry of asArray(raw, "chapters")) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const start = seconds(item.start, durationSeconds);
    const title = cleanText(item.title, 90);
    if (start === null || !title) continue;
    candidates.push({ start, title, summary: cleanText(item.summary, 280) });
  }
  candidates.sort((a, b) => a.start - b.start);

  const chapters: Chapter[] = [];
  for (const chapter of candidates) {
    const previous = chapters[chapters.length - 1];
    if (previous && chapter.start - previous.start < MIN_CHAPTER_GAP_SECONDS) continue;
    chapters.push(chapter);
    if (chapters.length >= MAX_CHAPTERS) break;
  }
  if (chapters.length > 0) chapters[0] = { ...chapters[0], start: 0 };
  return chapters;
}

/* ------------------------------------------------------------------ */
/* Storage as study notes                                              */
/* ------------------------------------------------------------------ */

/**
 * Key terms and chapters are stored as studyNotes rows (no migration needed)
 * with `metadata.insight` naming which one; they are left out wherever notes
 * are listed for reading.
 */
export type InsightKind = "key_terms" | "chapters";

export function insightKindOf(metadata: unknown): InsightKind | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).insight;
  return value === "key_terms" || value === "chapters" ? value : null;
}

export function isInsightNote(metadata: unknown): boolean {
  return insightKindOf(metadata) !== null;
}

/** Plain Markdown version stored as the note's content, so exports stay readable. */
export function chaptersToMarkdown(chapters: Chapter[], format: (seconds: number) => string): string {
  return chapters.map(chapter => `- **${format(chapter.start)}** ${chapter.title}${chapter.summary ? `: ${chapter.summary}` : ""}`).join("\n");
}
