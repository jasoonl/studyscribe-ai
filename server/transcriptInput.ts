import { z } from "zod";

export const transcriptUpdateInputSchema = z.object({
  recordingId: z.number().int().positive(),
  fullText: z.string().trim().min(1, "Transcript cannot be empty").max(200_000, "Transcript is too long"),
});
