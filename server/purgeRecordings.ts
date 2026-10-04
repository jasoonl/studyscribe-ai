import { inArray } from "drizzle-orm";
import {
  chatHistory, emailDrafts, flashcardReviews, flashcards, quizzes, recordingShares, recordingTags,
  recordings, studyGuides, studyNotes, transcripts, userNotifications,
} from "../drizzle/schema";
import { getDb } from "./db";
import { deleteStoredAudio } from "./storage";

/**
 * Permanently removes recordings: the stored audio first, then every row that
 * hangs off them. The audio goes first and a failure stops everything, because
 * dropping the rows while the file survives orphans it with nothing left that
 * points at it, still counting against the storage limit forever.
 */
export async function purgeRecordings(rows: Array<{ id: number; audioKey: string | null }>): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const ids = rows.map((row) => row.id);
  await deleteStoredAudio(rows.map((row) => row.audioKey ?? ""));

  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    await db.delete(transcripts).where(inArray(transcripts.recordingId, batch));
    await db.delete(studyNotes).where(inArray(studyNotes.recordingId, batch));
    await db.delete(flashcards).where(inArray(flashcards.recordingId, batch));
    await db.delete(flashcardReviews).where(inArray(flashcardReviews.recordingId, batch));
    await db.delete(chatHistory).where(inArray(chatHistory.recordingId, batch));
    await db.delete(recordingTags).where(inArray(recordingTags.recordingId, batch));
    await db.delete(studyGuides).where(inArray(studyGuides.recordingId, batch));
    await db.delete(quizzes).where(inArray(quizzes.recordingId, batch));
    await db.delete(emailDrafts).where(inArray(emailDrafts.recordingId, batch));
    await db.delete(recordingShares).where(inArray(recordingShares.recordingId, batch));
    await db.delete(userNotifications).where(inArray(userNotifications.recordingId, batch));
    await db.delete(recordings).where(inArray(recordings.id, batch));
  }
  return { deleted: ids.length };
}
