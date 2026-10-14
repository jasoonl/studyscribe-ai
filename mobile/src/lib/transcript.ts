import { formatTimestamp } from "./format";

export type Segment = { id?: string; start: number; end: number; text: string; speaker?: string };

/** Index of every segment containing the search term (case-insensitive). */
export function findMatches(segments: Segment[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return segments.flatMap((segment, index) => (segment.text.toLowerCase().includes(needle) ? [index] : []));
}

/** The segment playing at `time`, or -1. */
export function activeSegmentIndex(segments: Segment[], time: number): number {
  for (let index = segments.length - 1; index >= 0; index--) {
    if (time >= segments[index].start) return time <= segments[index].end + 1.5 ? index : -1;
  }
  return -1;
}

/** Plain text with speakers and times, for sharing (the web's TXT export). */
export function transcriptAsText(title: string, segments: Segment[], fullText: string) {
  const joined = segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim();
  // Edits change fullText only; when they differ the edited text is the truth.
  if (!segments.length || joined !== fullText.replace(/\s+/g, " ").trim()) return `${title}\n\n${fullText}`;
  return `${title}\n\n${segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`).join("\n\n")}`;
}
