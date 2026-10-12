/**
 * Pure rules for transcript comments and highlights (B7): where an annotation
 * may anchor, who may resolve or delete it, and how rows become threads. No
 * database here so the rules can be tested directly.
 */
import { type AccessRole, roleAllows } from "./sharing";

export const MAX_QUOTE_CHARS = 500;
export const MAX_COMMENT_CHARS = 4000;

export type AnchorSegment = { id?: string; text: string };

export type AnchorInput = {
  segmentIndex: number;
  segmentId?: string | null;
  startOffset: number;
  endOffset: number;
  quote: string;
};

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Checks that an anchor points at real text in the current transcript: the
 * segment exists (and is the same segment, when an id is given), the offsets
 * are inside its text, and the quoted words are what is there. Returns the
 * anchor with the quote taken from the transcript itself, or an error.
 */
export function validateAnchor(segments: AnchorSegment[] | null | undefined, input: AnchorInput): { ok: true; anchor: AnchorInput } | { ok: false; reason: string } {
  if (!Array.isArray(segments) || segments.length === 0) return { ok: false, reason: "This transcript has no lines to comment on." };
  const segment = segments[input.segmentIndex];
  if (!segment || typeof segment.text !== "string") return { ok: false, reason: "That line is no longer in the transcript." };
  if (input.segmentId && segment.id && segment.id !== input.segmentId) return { ok: false, reason: "The transcript changed. Reload and try again." };
  const { startOffset, endOffset } = input;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset > segment.text.length || endOffset <= startOffset) {
    return { ok: false, reason: "Select some words in one line of the transcript." };
  }
  const actual = segment.text.slice(startOffset, endOffset);
  if (squash(actual) !== squash(input.quote)) return { ok: false, reason: "The transcript changed. Reload and try again." };
  if (actual.length > MAX_QUOTE_CHARS) return { ok: false, reason: `Select at most ${MAX_QUOTE_CHARS} characters.` };
  return { ok: true, anchor: { ...input, segmentId: segment.id ?? input.segmentId ?? null, quote: actual } };
}

export type AnnotationActor = { userId: number; role: AccessRole };

/** The thread's author, the recording's owner and editors may resolve it. */
export function canResolve(actor: AnnotationActor, threadAuthorId: number) {
  return actor.userId === threadAuthorId || roleAllows(actor.role, "edit");
}

/** Authors may delete their own; the owner may delete anything on their recording (moderation). */
export function canDelete(actor: AnnotationActor, authorId: number) {
  return actor.userId === authorId || actor.role === "owner";
}

export type AnnotationRowLike = {
  id: number;
  parentId: number | null;
  createdAt: Date | string;
};

/** Groups rows into root threads (oldest line first) with replies in time order. Orphaned replies are dropped. */
export function buildThreads<T extends AnnotationRowLike>(rows: T[]): Array<T & { replies: T[] }> {
  const time = (row: T) => new Date(row.createdAt).getTime();
  const roots = rows.filter(row => row.parentId === null).sort((a, b) => time(a) - time(b) || a.id - b.id);
  const repliesByRoot = new Map<number, T[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const list = repliesByRoot.get(row.parentId) ?? [];
    list.push(row);
    repliesByRoot.set(row.parentId, list);
  }
  return roots.map(root => ({ ...root, replies: (repliesByRoot.get(root.id) ?? []).sort((a, b) => time(a) - time(b) || a.id - b.id) }));
}

/**
 * Splits a segment's text into runs so highlights can be drawn without
 * overlapping marks: each run lists the annotation ids that cover it.
 */
export function splitIntoRuns(textLength: number, ranges: Array<{ id: number; start: number; end: number }>): Array<{ start: number; end: number; ids: number[] }> {
  const points = new Set<number>([0, textLength]);
  for (const range of ranges) {
    points.add(Math.max(0, Math.min(textLength, range.start)));
    points.add(Math.max(0, Math.min(textLength, range.end)));
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const runs: Array<{ start: number; end: number; ids: number[] }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    runs.push({ start, end, ids: ranges.filter(range => range.start < end && range.end > start).map(range => range.id) });
  }
  return runs;
}
