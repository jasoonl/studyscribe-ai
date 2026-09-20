import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getRecordingById,
  getRecordingByPublicShareToken,
  enablePublicShare,
  disablePublicShare,
  shareRecordingWithUser,
  unshareRecordingWithUser,
  getSharesForRecording,
  getRecordingShareForUser,
  getRecordingsSharedWithUser,
  getUserByEmail,
  getTranscriptByRecordingId,
  getStudyNotesByRecordingId,
  getFlashcardsByRecordingId,
  getStudyGuidesByRecordingId,
  getQuizzesByRecordingId,
  normalizeAuthEmail,
} from "./db";

async function assertOwner(recordingId: number, userId: number) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.isDeleted) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
  }
  if (recording.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this recording" });
  }
  return recording;
}

/**
 * `publicShareToken` is appended to the audio URL for no-login viewers — the
 * storage proxy has no session to authorize them with, so the token is the
 * only proof they're allowed to stream it. Signed-in recipients are
 * authorized by their share row instead and need no token.
 */
async function buildSharedBundle(recordingId: number, publicShareToken?: string) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.isDeleted) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
  }
  const audioUrl =
    recording.audioUrl && publicShareToken
      ? `${recording.audioUrl}${recording.audioUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(publicShareToken)}`
      : recording.audioUrl;
  const [transcript, studyNotes, flashcards, studyGuides, quizzes] = await Promise.all([
    getTranscriptByRecordingId(recordingId),
    getStudyNotesByRecordingId(recordingId),
    getFlashcardsByRecordingId(recordingId),
    getStudyGuidesByRecordingId(recordingId),
    getQuizzesByRecordingId(recordingId),
  ]);

  return {
    recording: {
      id: recording.id,
      title: recording.title,
      description: recording.description,
      audioUrl,
      duration: recording.duration,
      createdAt: recording.createdAt,
    },
    transcript: transcript ?? null,
    studyNotes,
    flashcards,
    studyGuides,
    quizzes,
  };
}

export const sharingRouter = router({
  /** Owner: current share state for a recording (public link + who it's shared with) */
  getShareState: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .query(async ({ input, ctx }) => {
      const recording = await assertOwner(input.recordingId, ctx.user.id);
      const shares = await getSharesForRecording(input.recordingId);
      return {
        publicShareToken: recording.publicShareToken ?? null,
        shares: shares.map((s) => ({
          id: s.id,
          sharedWithUserId: s.sharedWithUserId,
          sharedWithEmail: s.sharedWithEmail,
          createdAt: s.createdAt,
        })),
      };
    }),

  enablePublicLink: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertOwner(input.recordingId, ctx.user.id);
      const token = await enablePublicShare(input.recordingId);
      return { token };
    }),

  disablePublicLink: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertOwner(input.recordingId, ctx.user.id);
      await disablePublicShare(input.recordingId);
      return { success: true };
    }),

  shareWithUser: protectedProcedure
    .input(z.object({ recordingId: z.number(), email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      await assertOwner(input.recordingId, ctx.user.id);
      const normalizedEmail = normalizeAuthEmail(input.email);
      const recipient = await getUserByEmail(normalizedEmail);
      if (!recipient) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No StudyScribe account found for that email",
        });
      }
      if (recipient.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already own this recording" });
      }
      await shareRecordingWithUser({
        recordingId: input.recordingId,
        ownerId: ctx.user.id,
        sharedWithUserId: recipient.id,
        sharedWithEmail: recipient.email,
      });
      return { success: true, sharedWithEmail: recipient.email };
    }),

  unshareWithUser: protectedProcedure
    .input(z.object({ recordingId: z.number(), sharedWithUserId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertOwner(input.recordingId, ctx.user.id);
      await unshareRecordingWithUser(input.recordingId, input.sharedWithUserId);
      return { success: true };
    }),

  /** Recordings other people have shared with the current user */
  sharedWithMe: protectedProcedure.query(async ({ ctx }) => {
    return getRecordingsSharedWithUser(ctx.user.id);
  }),

  /** A logged-in recipient viewing a recording shared directly with them */
  getSharedWithMe: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .query(async ({ input, ctx }) => {
      const recording = await getRecordingById(input.recordingId);
      const isOwner = recording && recording.userId === ctx.user.id;
      if (!isOwner) {
        const share = await getRecordingShareForUser(input.recordingId, ctx.user.id);
        if (!share) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This recording has not been shared with you" });
        }
      }
      return buildSharedBundle(input.recordingId);
    }),

  /** Public, no-login access via a share link token */
  getByToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const recording = await getRecordingByPublicShareToken(input.token);
      if (!recording) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This share link is invalid or has been turned off" });
      }
      return buildSharedBundle(recording.id, input.token);
    }),
});
