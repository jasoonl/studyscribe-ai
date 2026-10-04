import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  chatHistory, emailDrafts, flashcardReviews, flashcards, inviteCodes, inviteRequests, noteTags, passwordResetTokens,
  pushSubscriptions, quizAttempts, quizzes, recordingShares, recordingTags, recordings, studyGuides, studyNotes, tags,
  transcripts, userNotifications, users,
} from "../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";
import { comparePassword } from "./authService";
import { getDb } from "./db";
import { purgeRecordings } from "./purgeRecordings";
import { deleteProviderTranscript } from "./speakerDiarization";

type Confirmable = { email: string; passwordHash: string | null };

/**
 * Deleting an account is irreversible, so a stolen or left-open session alone must not be
 * enough: the person has to retype their email, and anyone with a password has to give it.
 * Google-only accounts have no password, so the typed email is their confirmation.
 */
export async function verifyDeletionConfirmation(user: Confirmable, confirmEmail: string, password?: string) {
  if (confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return { ok: false as const, reason: "The email you typed does not match this account." };
  }
  if (user.passwordHash) {
    if (!password) return { ok: false as const, reason: "Enter your password to confirm." };
    if (!(await comparePassword(password, user.passwordHash))) return { ok: false as const, reason: "That password is not correct." };
  }
  return { ok: true as const };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

export const accountRouter = router({
  /** Everything we hold about the signed-in person, as one JSON document (never includes credentials). */
  exportData: protectedProcedure.mutation(async ({ ctx }) => {
    if (!checkTrpcRateLimit(`export:${ctx.user.id}`, 60 * 60 * 1000, 5)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You can export your data 5 times an hour. Try again later." });
    }
    const db = await requireDb();
    const userId = ctx.user.id;

    const recordingRows = await db.select().from(recordings).where(eq(recordings.userId, userId));
    const owned = recordingRows.map((row) => row.id);
    const quizRows = await db.select().from(quizzes).where(eq(quizzes.userId, userId));

    return {
      exportedAt: new Date().toISOString(),
      account: {
        email: ctx.user.email,
        name: ctx.user.name,
        loginMethod: ctx.user.loginMethod,
        createdAt: ctx.user.createdAt,
        lastSignedIn: ctx.user.lastSignedIn,
        termsAcceptedAt: ctx.user.termsAcceptedAt ?? null,
      },
      recordings: recordingRows.map(({ audioKey, audioUrl, transcriptionProviderId, ...rest }) => rest),
      transcripts: await db.select().from(transcripts).where(eq(transcripts.userId, userId)),
      studyNotes: await db.select().from(studyNotes).where(eq(studyNotes.userId, userId)),
      flashcards: await db.select().from(flashcards).where(eq(flashcards.userId, userId)),
      flashcardReviews: await db.select().from(flashcardReviews).where(eq(flashcardReviews.userId, userId)),
      studyGuides: await db.select().from(studyGuides).where(eq(studyGuides.userId, userId)),
      quizzes: quizRows,
      quizAttempts: await db.select().from(quizAttempts).where(eq(quizAttempts.userId, userId)),
      emailDrafts: await db.select().from(emailDrafts).where(eq(emailDrafts.userId, userId)),
      chatHistory: await db.select().from(chatHistory).where(eq(chatHistory.userId, userId)),
      tags: await db.select().from(tags).where(eq(tags.userId, userId)),
      notifications: await db.select().from(userNotifications).where(eq(userNotifications.userId, userId)),
      sharedWithOthers: owned.length
        ? (await db.select().from(recordingShares).where(inArray(recordingShares.recordingId, owned))).map((share) => ({
            recordingId: share.recordingId,
            sharedWithEmail: share.sharedWithEmail,
            createdAt: share.createdAt,
          }))
        : [],
    };
  }),

  /**
   * Permanently deletes the account and everything attached to it: stored audio first (a failure
   * stops the whole thing so no file is orphaned), the transcription provider's copies, every
   * row in every table, then the user. The session cookie is cleared on success.
   */
  deleteAccount: protectedProcedure
    .input(z.object({ confirmEmail: z.string().max(320), password: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!checkTrpcRateLimit(`delete-account:${user.id}`, 15 * 60 * 1000, 5)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again in a few minutes." });
      }

      const db = await requireDb();
      const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (!fresh) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });

      const check = await verifyDeletionConfirmation(fresh, input.confirmEmail, input.password);
      if (!check.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: check.reason });

      if (fresh.role === "admin") {
        const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
        if (admins.filter((admin) => admin.id !== fresh.id).length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You are the only admin. Make someone else an admin before deleting this account." });
        }
      }

      const userId = fresh.id;
      const ownRecordings = await db.select().from(recordings).where(eq(recordings.userId, userId));

      const providerFailures: string[] = [];
      for (const row of ownRecordings) {
        if (row.transcriptionProviderId && !(await deleteProviderTranscript(row.transcriptionProviderId))) {
          providerFailures.push(row.transcriptionProviderId);
        }
      }

      await purgeRecordings(ownRecordings);

      const ownTags = await db.select({ id: tags.id }).from(tags).where(eq(tags.userId, userId));
      if (ownTags.length) {
        const tagIds = ownTags.map((tag) => tag.id);
        await db.delete(noteTags).where(inArray(noteTags.tagId, tagIds));
        await db.delete(recordingTags).where(inArray(recordingTags.tagId, tagIds));
      }
      await db.delete(tags).where(eq(tags.userId, userId));
      await db.delete(transcripts).where(eq(transcripts.userId, userId));
      await db.delete(studyNotes).where(eq(studyNotes.userId, userId));
      await db.delete(flashcards).where(eq(flashcards.userId, userId));
      await db.delete(flashcardReviews).where(eq(flashcardReviews.userId, userId));
      await db.delete(chatHistory).where(eq(chatHistory.userId, userId));
      await db.delete(studyGuides).where(eq(studyGuides.userId, userId));
      await db.delete(quizAttempts).where(eq(quizAttempts.userId, userId));
      await db.delete(quizzes).where(eq(quizzes.userId, userId));
      await db.delete(emailDrafts).where(eq(emailDrafts.userId, userId));
      await db.delete(userNotifications).where(eq(userNotifications.userId, userId));
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
      await db.delete(recordingShares).where(or(eq(recordingShares.ownerId, userId), eq(recordingShares.sharedWithUserId, userId)));
      await db.delete(inviteCodes).where(or(eq(inviteCodes.createdBy, userId), eq(inviteCodes.usedBy, userId), eq(inviteCodes.email, fresh.email)));
      await db.delete(inviteRequests).where(eq(inviteRequests.email, fresh.email));
      await db.delete(users).where(and(eq(users.id, userId)));

      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { deleted: true as const, providerCopiesNotRemoved: providerFailures.length };
    }),
});
