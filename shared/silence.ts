/**
 * "Skip silence" (B5): stretches with no speech, worked out from the
 * transcript's timed segments. A gap between the end of one segment and the
 * start of the next (or before the first, or after the last) longer than
 * `minGapSeconds` is skippable; the player jumps from just after the speech
 * stops to just before it starts again, keeping `paddingSeconds` either side
 * so words are never clipped.
 */

export type TimedSegment = { start: number; end: number };
export type SilentGap = { start: number; end: number };

export const DEFAULT_MIN_GAP_SECONDS = 2;
export const DEFAULT_PADDING_SECONDS = 0.4;

export function computeSilentGaps(
  segments: TimedSegment[],
  options: { minGapSeconds?: number; paddingSeconds?: number; duration?: number } = {},
): SilentGap[] {
  const minGap = options.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS;
  const padding = options.paddingSeconds ?? DEFAULT_PADDING_SECONDS;
  const timed = segments
    .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end >= segment.start)
    .map(segment => ({ start: Math.max(0, segment.start), end: segment.end }))
    .sort((a, b) => a.start - b.start);
  if (timed.length === 0) return [];

  // Merge overlapping speech (diarization can overlap speakers).
  const speech: TimedSegment[] = [];
  for (const segment of timed) {
    const last = speech[speech.length - 1];
    if (last && segment.start <= last.end) last.end = Math.max(last.end, segment.end);
    else speech.push({ ...segment });
  }

  const gaps: SilentGap[] = [];
  const consider = (silenceStart: number, silenceEnd: number, padStart: boolean, padEnd: boolean) => {
    if (silenceEnd - silenceStart < minGap) return;
    const start = silenceStart + (padStart ? padding : 0);
    const end = silenceEnd - (padEnd ? padding : 0);
    if (end - start > 0.25) gaps.push({ start, end });
  };

  consider(0, speech[0].start, false, true);
  for (let i = 0; i < speech.length - 1; i++) consider(speech[i].end, speech[i + 1].start, true, true);
  const duration = options.duration;
  if (duration && Number.isFinite(duration) && duration > speech[speech.length - 1].end) {
    consider(speech[speech.length - 1].end, duration, true, false);
  }
  return gaps;
}

/** Where to jump to if `time` is inside a silent gap, otherwise null. */
export function skipTargetAt(gaps: SilentGap[], time: number): number | null {
  for (const gap of gaps) {
    if (time >= gap.start && time < gap.end - 0.05) return gap.end;
    if (gap.start > time) break;
  }
  return null;
}

export function totalSilence(gaps: SilentGap[]): number {
  return gaps.reduce((sum, gap) => sum + (gap.end - gap.start), 0);
}
