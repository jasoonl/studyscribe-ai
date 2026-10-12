/**
 * Keeps what is sent to the model small enough to answer well inside one
 * serverless function run. A three-hour lecture is ~150k characters; sending
 * all of it makes a request slow enough to hit the 60s function limit, so the
 * transcript is condensed to a character budget while keeping timestamps and
 * coverage of the whole recording (the end of a lecture is where assignments
 * are usually announced, so cutting the tail off is the wrong trade).
 */
import { formatTimestamp } from "@shared/timestamp";

export type BudgetSegment = { start: number; end?: number; text: string; speaker?: string };

/** Default budget for one recording: roughly 12k tokens. */
export const SINGLE_RECORDING_BUDGET = 48_000;
/** Combined budget for an exam pack, split between its recordings. */
export const EXAM_PACK_BUDGET = 60_000;
/** Lines are merged into windows of about this many seconds before trimming. */
const WINDOW_SECONDS = 45;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** Groups consecutive segments into ~45 second windows, each tagged with its start time. */
export function windowSegments(segments: BudgetSegment[], windowSeconds = WINDOW_SECONDS): Array<{ start: number; text: string }> {
  const windows: Array<{ start: number; text: string }> = [];
  for (const segment of segments) {
    const text = segment.text?.trim();
    if (!text || !Number.isFinite(segment.start)) continue;
    const current = windows[windows.length - 1];
    if (current && segment.start - current.start < windowSeconds) {
      current.text += ` ${text}`;
    } else {
      windows.push({ start: Math.max(0, segment.start), text });
    }
  }
  return windows;
}

/**
 * The transcript as "[m:ss] text" lines, at most `maxChars` long. When it is
 * too long every window is shortened by the same proportion, so the whole
 * recording stays represented. Without segments, the plain text is sampled
 * from the start, middle and end instead.
 */
export function condenseTranscript(
  source: { segments?: BudgetSegment[] | null; fullText?: string | null },
  maxChars = SINGLE_RECORDING_BUDGET,
): { text: string; timestamped: boolean; trimmed: boolean } {
  const segments = Array.isArray(source.segments) ? source.segments : [];
  const windows = windowSegments(segments);

  if (windows.length === 0) {
    const plain = (source.fullText ?? "").trim();
    if (plain.length <= maxChars) return { text: plain, timestamped: false, trimmed: false };
    const part = Math.floor((maxChars - 20) / 3);
    const middle = Math.floor(plain.length / 2 - part / 2);
    return {
      text: [clip(plain, part), clip(plain.slice(middle), part), clip(plain.slice(plain.length - part), part)].join("\n[…]\n"),
      timestamped: false,
      trimmed: true,
    };
  }

  const lines = windows.map(window => ({ prefix: `[${formatTimestamp(window.start)}] `, text: window.text }));
  const total = lines.reduce((sum, line) => sum + line.prefix.length + line.text.length + 1, 0);
  if (total <= maxChars) {
    return { text: lines.map(line => line.prefix + line.text).join("\n"), timestamped: true, trimmed: false };
  }

  // Prefixes and newlines are fixed costs; only the text shrinks.
  const fixed = lines.reduce((sum, line) => sum + line.prefix.length + 1, 0);
  const textTotal = total - fixed;
  const available = Math.max(0, maxChars - fixed);
  if (available < lines.length * 24) {
    // Too many windows for even a short line each: keep every nth window.
    const keepEvery = Math.ceil((lines.length * 64) / Math.max(1, maxChars));
    const kept = lines.filter((_, index) => index % keepEvery === 0);
    const per = Math.max(24, Math.floor(maxChars / kept.length) - 10);
    const text = kept.map(line => line.prefix + clip(line.text, per)).join("\n");
    return { text: text.slice(0, maxChars), timestamped: true, trimmed: true };
  }
  const ratio = available / textTotal;
  const text = lines.map(line => line.prefix + clip(line.text, Math.max(24, Math.floor(line.text.length * ratio)))).join("\n");
  return { text: text.length > maxChars ? text.slice(0, maxChars) : text, timestamped: true, trimmed: true };
}

/**
 * Splits a combined budget between several recordings in proportion to their
 * length, with a floor so a short recording is not reduced to nothing.
 */
export function allocateBudget(lengths: number[], total = EXAM_PACK_BUDGET, floor = 4_000): number[] {
  if (lengths.length === 0) return [];
  const sum = lengths.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= total) return lengths.map(length => Math.max(0, length));
  const minimum = Math.min(floor, Math.floor(total / lengths.length));
  const spare = total - minimum * lengths.length;
  const overMinimum = lengths.map(length => Math.max(0, length - minimum));
  const overSum = overMinimum.reduce((a, b) => a + b, 0) || 1;
  return lengths.map((length, index) => Math.min(length, minimum + Math.floor((spare * overMinimum[index]) / overSum)));
}
