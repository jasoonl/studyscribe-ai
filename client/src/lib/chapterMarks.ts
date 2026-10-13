import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";

export type ChapterMark = { start: number; title: string; percent: number; label: string };

/**
 * Where to draw chapter marks on the player's progress bar, as percentages of
 * the length. The first chapter always starts at 0 and gets no mark; marks at
 * or past the end, or before the length is known, are left out.
 */
export function chapterMarkPositions(chapters: Array<{ start: number; title: string }> | null | undefined, duration: number): ChapterMark[] {
  if (!chapters?.length || !Number.isFinite(duration) || duration <= 0) return [];
  const marks: ChapterMark[] = [];
  for (const chapter of chapters) {
    if (!Number.isFinite(chapter.start) || chapter.start <= 0 || chapter.start >= duration) continue;
    const percent = Math.round((chapter.start / duration) * 10000) / 100;
    marks.push({ start: chapter.start, title: chapter.title, percent, label: `${formatTranscriptTimestamp(chapter.start)} ${chapter.title}` });
  }
  return marks.sort((a, b) => a.start - b.start);
}
