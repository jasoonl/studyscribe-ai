import { z } from "zod";

export const transcriptUpdateInputSchema = z.object({
  recordingId: z.number().int().positive(),
  fullText: z.string().trim().min(1, "Transcript cannot be empty").max(200_000, "Transcript is too long"),
});

export const speakerRenameInputSchema = z.object({
  recordingId: z.number().int().positive(),
  from: z.string().min(1).max(100),
  to: z.string().trim().min(1, "Speaker name cannot be empty").max(60, "Speaker name is too long"),
});

type SpeakerSegment = { speaker?: string };

/**
 * Renames every segment spoken by `from`. Renaming to a name another speaker
 * already has merges the two, which is how a mis-split speaker gets fixed.
 * Returns null when no segment has that speaker.
 */
export function renameSpeakerInSegments<T extends SpeakerSegment>(segments: T[], from: string, to: string): T[] | null {
  const name = to.trim();
  if (!segments.some(segment => segment.speaker === from)) return null;
  return segments.map(segment => (segment.speaker === from ? { ...segment, speaker: name } : segment));
}
