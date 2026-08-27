export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export function formatTranscriptTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function getActiveTranscriptSegmentIndex(segments: TranscriptSegment[], playbackTime: number) {
  return segments.findIndex((segment) => playbackTime >= segment.start && playbackTime < segment.end);
}
