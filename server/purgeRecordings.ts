import { deletePlannerDataForRecordings } from "./planner";
import { inArray } from "drizzle-orm";
import {
  chatHistory, emailDrafts, flashcardReviews, flashcards, quizzes, recordingShares, recordingTags,
  recordings, studyGuides, studyNotes, transcripts, userNotifications,
} from "../drizzle/schema";
import { deleteBookmarksForRecordings } from "./bookmarks";
import { deleteCourseLinksForRecordings } from "./courses";
import { deleteActionItemsForRecordings } from "./actionItems";
import { deleteExamPacksForRecordings } from "./examPacks";
import { deleteSessionsForRecordings } from "./practiceSessions";
import { deleteExplanationsForRecordings } from "./mistakeExplanations";
import { deleteVocabularyForRecordings } from "./vocabulary";
import { deleteFollowUpsForRecordings } from "./followUps";
import { deleteAnnotationsForRecordings } from "./annotations";
import { deleteChunksForRecordings } from "./embeddings";
import { deleteGroupSharesForRecordings } from "./groups";
import { deleteTranslationsForRecordings } from "./translations";
import { getDb } from "./db";
import { StorageDeleteError, deleteStoredAudio } from "./storage";
import { deleteSlidesForRecordings } from "./slides";
import { deleteRecordingEventsForRecordings } from "./recordingEvents";
import { detachBotsFromRecordings } from "./meetingBots";
import { deleteAttendeeEmailsForRecordings } from "./attendeeEmail";

/**
 * Permanently removes recordings: the stored audio first, then every row that
 * hangs off them. The audio goes first and a failure stops everything, because
 * dropping the rows while the file survives orphans it with nothing left that
 * points at it, still counting against the storage limit forever.
 */
export async function purgeRecordings(rows: Array<{ id: number; audioKey: string | null }>): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // If some files could not be removed, their recordings are kept (never drop the row of a file that survives);
  // the rest are purged and the failure is reported at the end.
  let incomplete: StorageDeleteError | null = null;
  try {
    await deleteStoredAudio(rows.map((row) => row.audioKey ?? ""));
  } catch (error) {
    if (!(error instanceof StorageDeleteError)) throw error;
    incomplete = error;
    const failed = new Set(error.failedKeys);
    rows = rows.filter((row) => !(row.audioKey && failed.has(row.audioKey)));
  }
  const ids = rows.map((row) => row.id);
  // Captured slides are stored files too; the same rule applies.
  await deleteSlidesForRecordings(ids);

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
    await deleteBookmarksForRecordings(batch);
    await deletePlannerDataForRecordings(batch);
    await deleteCourseLinksForRecordings(batch);
    await deleteActionItemsForRecordings(batch);
    await deleteVocabularyForRecordings(batch);
    await deleteFollowUpsForRecordings(batch);
    await deleteAnnotationsForRecordings(batch);
    await deleteChunksForRecordings(batch);
    await deleteGroupSharesForRecordings(batch);
    await deleteTranslationsForRecordings(batch);
    await deleteRecordingEventsForRecordings(batch);
    await detachBotsFromRecordings(batch);
    await deleteAttendeeEmailsForRecordings(batch);
    // Before the recordings rows go: it looks up whose packs to check.
    await deleteSessionsForRecordings(batch);
    await deleteExplanationsForRecordings(batch);
    await deleteExamPacksForRecordings(batch);
    await db.delete(userNotifications).where(inArray(userNotifications.recordingId, batch));
    await db.delete(recordings).where(inArray(recordings.id, batch));
  }
  if (incomplete) throw new Error(`${incomplete.message}, so those recordings were kept. Try again in a moment.`);
  return { deleted: ids.length };
}
