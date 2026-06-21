import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { notifyOwner } from "./_core/notification";

export const notificationsRouter = router({
  // Send a notification to the project owner
  notifyOwner: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await notifyOwner({
          title: input.title,
          content: input.content,
        });
        return { success: result };
      } catch (error) {
        console.error("Failed to send owner notification:", error);
        return { success: false };
      }
    }),

  // Example: Send notification when a recording is completed
  recordingCompleted: protectedProcedure
    .input(
      z.object({
        recordingTitle: z.string(),
        duration: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await notifyOwner({
          title: "Recording Completed",
          content: `User ${ctx.user.email} completed recording: "${input.recordingTitle}" (${Math.round(input.duration / 1000)}s)`,
        });
        return { success: true };
      } catch (error) {
        console.error("Failed to send recording completion notification:", error);
        return { success: false };
      }
    }),

  // Example: Send notification when transcription is done
  transcriptionCompleted: protectedProcedure
    .input(
      z.object({
        recordingTitle: z.string(),
        wordCount: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await notifyOwner({
          title: "Transcription Completed",
          content: `Transcription ready for "${input.recordingTitle}" (${input.wordCount} words) by ${ctx.user.email}`,
        });
        return { success: true };
      } catch (error) {
        console.error("Failed to send transcription notification:", error);
        return { success: false };
      }
    }),

  // Example: Send notification for AI generation events
  aiGenerationCompleted: protectedProcedure
    .input(
      z.object({
        type: z.enum(["summary", "flashcards", "tutor"]),
        recordingTitle: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const typeLabel = {
          summary: "Summary",
          flashcards: "Flashcards",
          tutor: "AI Tutor",
        }[input.type];

        await notifyOwner({
          title: `${typeLabel} Generated`,
          content: `${typeLabel} generated for "${input.recordingTitle}" by ${ctx.user.email}`,
        });
        return { success: true };
      } catch (error) {
        console.error("Failed to send AI generation notification:", error);
        return { success: false };
      }
    }),
});
