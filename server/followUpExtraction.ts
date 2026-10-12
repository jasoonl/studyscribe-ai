/**
 * Prompt and output validation for follow-up suggestions (C7). Pure, so the
 * tests can cover what ends up in front of a student.
 */
import { addDays } from "@shared/actionItems";
import {
  FOLLOW_UP_KINDS,
  MAX_FOLLOW_UPS,
  MAX_FOLLOW_UP_DAYS,
  MAX_FOLLOW_UP_DETAIL,
  MAX_FOLLOW_UP_TITLE,
  type FollowUpKind,
} from "@shared/followUps";
import { actionItemKey, asArray, cleanText } from "./studyExtraction";

type ChatMessage = { role: "system" | "user"; content: string };

export const FOLLOW_UPS_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "follow_ups",
    strict: true,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...FOLLOW_UP_KINDS] },
              title: { type: "string" },
              detail: { type: "string" },
              inDays: { type: "integer" },
            },
            required: ["kind", "title", "detail", "inDays"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
};

export function buildFollowUpMessages(input: {
  title: string;
  audience: string | null;
  transcript: string;
  flashcardCount: number;
}): ChatMessage[] {
  const meeting = input.audience === "professional";
  return [
    {
      role: "system",
      content: [
        `You plan what someone should do in the days after a ${meeting ? "meeting" : "lecture"} so it sticks.`,
        `Suggest 3 to ${MAX_FOLLOW_UPS} concrete follow-ups, each tied to specific ideas from the transcript (name them). No generic advice such as "review your notes".`,
        "Spread them out the way spaced review works: something today or tomorrow (inDays 0 or 1), something around day 3, and something around day 7. inDays is whole days from today, 0 to " + MAX_FOLLOW_UP_DAYS + ".",
        "kind is review (go back over named concepts), practice (test yourself: flashcards, worked problems, explaining it aloud), ask (a question to bring to the next class, office hours or meeting) or read (something to look up or read further).",
        input.flashcardCount > 0
          ? `They already have ${input.flashcardCount} flashcards for this recording, so a practice step can be reviewing those.`
          : "They have no flashcards for this recording yet; a practice step can suggest making some.",
        "title is a short instruction, at most 12 words (\"Review how enzymes lower activation energy\"). detail is one or two sentences on what exactly to do. Write in the transcript's language.",
      ].join(" "),
    },
    { role: "user", content: `Recording: ${input.title}\n\nTranscript:\n${input.transcript}` },
  ];
}

export type ExtractedFollowUp = { kind: FollowUpKind; title: string; detail: string | null; dueDate: string };

/** Drops empty and duplicate items, clamps the day offset, dates each item from `today`, earliest first. */
export function normalizeFollowUps(raw: unknown, today: string): ExtractedFollowUp[] {
  const seen = new Set<string>();
  const result: Array<ExtractedFollowUp & { order: number }> = [];
  for (const entry of asArray(raw, "items")) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const title = cleanText(item.title, MAX_FOLLOW_UP_TITLE);
    if (title.length < 3) continue;
    const key = actionItemKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const kind = FOLLOW_UP_KINDS.includes(item.kind as FollowUpKind) ? (item.kind as FollowUpKind) : "review";
    const rawDays = typeof item.inDays === "number" ? item.inDays : Number(item.inDays);
    const inDays = Number.isFinite(rawDays) ? Math.min(MAX_FOLLOW_UP_DAYS, Math.max(0, Math.round(rawDays))) : 1;
    result.push({
      kind,
      title,
      detail: cleanText(item.detail, MAX_FOLLOW_UP_DETAIL) || null,
      dueDate: addDays(today, inDays),
      order: result.length,
    });
    if (result.length >= MAX_FOLLOW_UPS) break;
  }
  return result
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.order - b.order)
    .map(({ order: _order, ...item }) => item);
}

/** One notification per person, listing what is due. */
export function buildReminderMessage(items: Array<{ title: string; recordingTitle: string }>): { title: string; body: string } {
  const first = items[0];
  if (items.length === 1) return { title: "Today's follow-up", body: `${first.title} (${first.recordingTitle})` };
  const more = items.length - 1;
  return { title: `${items.length} follow-ups for today`, body: `${first.title}, and ${more} more` };
}
