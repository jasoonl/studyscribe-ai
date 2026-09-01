import { eq, and, like, or, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { InsertUser, users, recordings, transcripts, studyNotes, flashcards, flashcardReviews, chatHistory, tags, recordingTags, noteTags, inviteCodes, passwordResetTokens, inviteRequests, InsertInviteRequest, pushSubscriptions } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

type ExternalDatabaseConfig =
  | { kind: "url"; url: string }
  | {
      kind: "tidb";
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      ssl: { minVersion: "TLSv1.2"; rejectUnauthorized: true };
    }
  | null;

/**
 * TiDB Cloud’s current Connect dialog provides independent .env values. Those
 * fields take precedence over an old DATABASE_URL to prevent a stale/manual
 * URL from blocking the external Vercel deployment.
 */
export function getExternalDatabaseConfig(): ExternalDatabaseConfig {
  const getTiDbFields = (prefix: "TIDB" | "DB") => ({
    host: process.env[`${prefix}_HOST`]?.trim(),
    port: process.env[`${prefix}_PORT`],
    user: process.env[`${prefix}_USER`]?.trim() || process.env[`${prefix}_USERNAME`]?.trim(),
    password: process.env[`${prefix}_PASSWORD`],
    database: process.env[`${prefix}_DATABASE`]?.trim() || process.env[`${prefix}_DB_NAME`]?.trim(),
  });
  const tidbFields = getTiDbFields("TIDB");
  const dbFields = getTiDbFields("DB");
  const fields = tidbFields.host || tidbFields.user || tidbFields.password || tidbFields.database
    ? tidbFields
    : dbFields;
  if (fields.host || fields.user || fields.password || fields.database) {
    if (!fields.host || !fields.user || !fields.password || !fields.database) return null;
    const requestedPort = Number.parseInt(fields.port || "4000", 10);
    return {
      kind: "tidb",
      host: fields.host,
      port: Number.isFinite(requestedPort) ? requestedPort : 4000,
      user: fields.user,
      password: fields.password,
      database: fields.database,
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    };
  }

  const url = process.env.DATABASE_URL?.trim();
  return url ? { kind: "url", url } : null;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  const config = getExternalDatabaseConfig();
  if (!_db && config) {
    try {
      _db = config.kind === "url"
        ? drizzle(config.url)
        : drizzle({ client: createPool(config) });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// Auth helpers
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByGoogleId(googleId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  // Support both old Manus OAuth (openId) and new custom auth (email)
  if (!user.openId && !user.email) {
    throw new Error("Either openId or email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      email: user.email || "unknown@example.com",
      ...(user.openId && { openId: user.openId }),
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    // Handle password hash
    if (user.passwordHash !== undefined) {
      values.passwordHash = user.passwordHash;
      updateSet.passwordHash = user.passwordHash;
    }

    // Handle Google ID
    if (user.googleId !== undefined) {
      values.googleId = user.googleId;
      updateSet.googleId = user.googleId;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Invite code helpers
export async function createInviteCode(data: {
  code: string;
  email: string;
  createdBy: number;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(inviteCodes).values(data);
}

export async function getInviteCodeByCode(code: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function markInviteCodeAsUsed(code: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(inviteCodes).set({
    isUsed: 1,
    usedBy: userId,
    usedAt: new Date(),
  }).where(eq(inviteCodes.code, code));
}

export async function getInviteCodesByCreatedBy(createdBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(inviteCodes).where(eq(inviteCodes.createdBy, createdBy));
}

// Password reset token helpers
export async function createPasswordResetToken(data: {
  userId: number;
  token: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(passwordResetTokens).values(data);
}

export async function getPasswordResetTokenByToken(token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deletePasswordResetToken(token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.delete(passwordResetTokens).where(eq(passwordResetTokens.token, token));
}

// Browser push subscription helpers
export async function upsertPushSubscription(data: {
  userId: number;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpointHash, data.endpointHash))
    .limit(1);

  if (existing[0]) {
    await db
      .update(pushSubscriptions)
      .set({
        userId: data.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        expirationTime: data.expirationTime,
        updatedAt: new Date(),
      })
      .where(eq(pushSubscriptions.id, existing[0].id));
    return { ...existing[0], ...data };
  }

  await db.insert(pushSubscriptions).values(data);
  const created = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpointHash, data.endpointHash))
    .limit(1);
  if (!created[0]) throw new Error("Failed to save browser push subscription");
  return created[0];
}

export async function getPushSubscriptionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

export async function deletePushSubscription(userId: number, endpointHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpointHash, endpointHash)));
}

// Recording helpers
export async function createRecording(data: {
  userId: number;
  title: string;
  description?: string;
  audioUrl: string;
  audioKey: string;
  duration?: number;
  audience?: "student" | "professional";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(recordings).values({
    userId: data.userId,
    title: data.title,
    description: data.description,
    audioUrl: data.audioUrl,
    audioKey: data.audioKey,
    duration: data.duration,
    audience: data.audience || "student",
    status: "processing",
  });

  return result;
}

export async function getRecordingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(recordings).where(
    and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0))
  );
}

export async function getRecordingById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(recordings).where(eq(recordings.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getRecordingByAudioKeyForUser(audioKey: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(recordings).where(
    and(eq(recordings.audioKey, audioKey), eq(recordings.userId, userId), eq(recordings.isDeleted, 0)),
  ).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getRecordingByTranscriptionProviderId(transcriptionProviderId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(recordings).where(
    eq(recordings.transcriptionProviderId, transcriptionProviderId),
  ).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function setRecordingTranscriptionProviderId(recordingId: number, transcriptionProviderId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(recordings).set({ transcriptionProviderId }).where(eq(recordings.id, recordingId));
}

export async function getProcessingRecordings() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(recordings).where(
    and(eq(recordings.status, "processing"), eq(recordings.isDeleted, 0)),
  );
}

export async function updateRecordingStatus(id: number, status: "processing" | "completed" | "failed") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(recordings).set({ status }).where(eq(recordings.id, id));
}

// Transcript helpers
export async function createTranscript(data: {
  recordingId: number;
  userId: number;
  fullText: string;
  segments?: Array<any>;
  language?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(transcripts).values({
    recordingId: data.recordingId,
    userId: data.userId,
    fullText: data.fullText,
    segments: data.segments,
    language: data.language || "en",
    status: "completed",
  });
}

export async function getTranscriptByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(transcripts).where(eq(transcripts.recordingId, recordingId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateTranscriptText(data: {
  recordingId: number;
  userId: number;
  fullText: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(transcripts)
    .set({ fullText: data.fullText, updatedAt: new Date() })
    .where(and(eq(transcripts.recordingId, data.recordingId), eq(transcripts.userId, data.userId)));

  return getTranscriptByRecordingId(data.recordingId);
}

// Study notes helpers
export async function createStudyNote(data: {
  recordingId: number;
  userId: number;
  type: "summary" | "key_concepts" | "action_items" | "formulas" | "study_guide";
  content: string;
  metadata?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(studyNotes).values(data);
}

export async function getStudyNotesByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(studyNotes).where(eq(studyNotes.recordingId, recordingId));
}

// Flashcard helpers
export async function createFlashcard(data: {
  recordingId: number;
  userId: number;
  question: string;
  answer: string;
  difficulty?: "easy" | "medium" | "hard";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(flashcards).values(data);
}

export async function getFlashcardsByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(flashcards).where(eq(flashcards.recordingId, recordingId));
}

export async function getFlashcardReviewsByRecordingId(userId: number, recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(flashcardReviews)
    .where(and(eq(flashcardReviews.userId, userId), eq(flashcardReviews.recordingId, recordingId)));
}

export async function recordFlashcardReview(data: {
  userId: number;
  recordingId: number;
  flashcardId: number;
  status: "new" | "learning" | "mastered";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(flashcardReviews)
    .where(
      and(
        eq(flashcardReviews.userId, data.userId),
        eq(flashcardReviews.flashcardId, data.flashcardId),
      ),
    )
    .limit(1);

  const now = new Date();
  const reviewValues = {
    status: data.status,
    lastReviewedAt: now,
    masteredAt: data.status === "mastered" ? now : null,
    updatedAt: now,
  };

  if (existing[0]) {
    const reviewCount = existing[0].reviewCount + 1;
    await db
      .update(flashcardReviews)
      .set({ ...reviewValues, reviewCount })
      .where(eq(flashcardReviews.id, existing[0].id));

    return { ...existing[0], ...reviewValues, reviewCount };
  }

  await db.insert(flashcardReviews).values({
    ...data,
    ...reviewValues,
    reviewCount: 1,
  });

  const created = await db
    .select()
    .from(flashcardReviews)
    .where(
      and(
        eq(flashcardReviews.userId, data.userId),
        eq(flashcardReviews.flashcardId, data.flashcardId),
      ),
    )
    .limit(1);

  if (!created[0]) throw new Error("Failed to save flashcard review");
  return created[0];
}

// Chat history helpers
export async function addChatMessage(data: {
  recordingId: number;
  userId: number;
  role: "user" | "assistant";
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(chatHistory).values(data);
}

export async function getChatHistoryByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(chatHistory).where(eq(chatHistory.recordingId, recordingId));
}

// Soft delete helpers
export async function softDeleteRecording(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(recordings).set({
    isDeleted: 1,
    deletedAt: new Date(),
  }).where(eq(recordings.id, id));
}

export async function getDeletedRecordingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(recordings).where(
    and(eq(recordings.userId, userId), eq(recordings.isDeleted, 1))
  );
}

export async function restoreRecording(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(recordings).set({
    isDeleted: 0,
    deletedAt: null,
  }).where(eq(recordings.id, id));
}

// Tag management helpers
export async function createTag(data: { userId: number; name: string; color?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(tags).values(data);
  // Return the created tag by querying
  const result = await db.select().from(tags).where(eq(tags.userId, data.userId)).orderBy((t) => t.id).limit(1);
  return result[0];
}

export async function getUserTags(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(tags).where(eq(tags.userId, userId));
}

export async function addTagToRecording(recordingId: number, tagId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(recordingTags).values({ recordingId, tagId });
  const result = await db.select().from(recordingTags).where(and(eq(recordingTags.recordingId, recordingId), eq(recordingTags.tagId, tagId))).limit(1);
  return result[0];
}

export async function removeTagFromRecording(recordingId: number, tagId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(recordingTags).where(
    and(eq(recordingTags.recordingId, recordingId), eq(recordingTags.tagId, tagId))
  );
}

export async function getRecordingTags(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(recordingTags).where(eq(recordingTags.recordingId, recordingId));
}

export async function addTagToNote(noteId: number, tagId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(noteTags).values({ noteId, tagId });
  const result = await db.select().from(noteTags).where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId))).limit(1);
  return result[0];
}

export async function removeTagFromNote(noteId: number, tagId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(noteTags).where(
    and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId))
  );
}

export async function getNoteTags(noteId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(noteTags).where(eq(noteTags.noteId, noteId));
}

// Invite request helpers
export async function createInviteRequest(data: {
  email: string;
  name: string;
  reason?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if there's already a pending request from this email
  const existing = await db
    .select()
    .from(inviteRequests)
    .where(and(eq(inviteRequests.email, data.email), eq(inviteRequests.status, "pending")))
    .limit(1);

  if (existing.length > 0) {
    throw new Error("A pending request already exists for this email address.");
  }

  return db.insert(inviteRequests).values({
    email: data.email,
    name: data.name,
    reason: data.reason,
    status: "pending",
  });
}

export async function getAllInviteRequests() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(inviteRequests).orderBy(inviteRequests.createdAt);
}

export async function getInviteRequestById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(inviteRequests).where(eq(inviteRequests.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateInviteRequestStatus(
  id: number,
  status: "approved" | "denied",
  reviewedBy: number,
  reviewNote?: string,
  inviteCodeId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(inviteRequests).set({
    status,
    reviewedBy,
    reviewedAt: new Date(),
    reviewNote: reviewNote ?? null,
    inviteCodeId: inviteCodeId ?? null,
  }).where(eq(inviteRequests.id, id));
}

// Invite code admin management helpers
export async function getAllInviteCodes() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Join with users to get the email of the person who used it
  return db.select().from(inviteCodes).orderBy(inviteCodes.createdAt);
}

export async function getInviteCodeById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(inviteCodes).where(eq(inviteCodes.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateInviteCodeExpiry(id: number, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(inviteCodes).set({ expiresAt }).where(eq(inviteCodes.id, id));
}

export async function revokeInviteCode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Mark as used with a sentinel value to indicate revocation (usedAt = now, isUsed = 1)
  return db.update(inviteCodes).set({
    isUsed: 1,
    usedAt: new Date(),
  }).where(eq(inviteCodes.id, id));
}

export async function deleteInviteCode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.delete(inviteCodes).where(eq(inviteCodes.id, id));
}

// ─── Study Guide helpers ────────────────────────────────────────────────────

import { studyGuides, quizzes, quizAttempts, emailDrafts } from "../drizzle/schema";

export async function createStudyGuide(data: {
  recordingId: number;
  userId: number;
  title: string;
  content: string;
  keyPoints?: string[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(studyGuides).values({
    recordingId: data.recordingId,
    userId: data.userId,
    title: data.title,
    content: data.content,
    keyPoints: data.keyPoints ?? [],
    status: "completed",
    generatedAt: new Date(),
  });
  return result;
}

export async function getStudyGuidesByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(studyGuides).where(eq(studyGuides.recordingId, recordingId));
}

export async function getStudyGuideById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(studyGuides).where(eq(studyGuides.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ─── Quiz helpers ────────────────────────────────────────────────────────────

export async function createQuiz(data: {
  recordingId: number;
  userId: number;
  title: string;
  description?: string;
  questions: Array<{
    id: string;
    question: string;
    type: "multiple-choice" | "short-answer";
    options?: string[];
    correctAnswer: string;
    explanation: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(quizzes).values({
    recordingId: data.recordingId,
    userId: data.userId,
    title: data.title,
    description: data.description,
    questions: data.questions,
    status: "completed",
    generatedAt: new Date(),
  });
  return result;
}

export async function getQuizzesByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(quizzes).where(eq(quizzes.recordingId, recordingId));
}

export async function getQuizById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(quizzes).where(eq(quizzes.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ─── Quiz Attempt helpers ────────────────────────────────────────────────────

export async function createQuizAttempt(data: {
  quizId: number;
  userId: number;
  answers: Record<string, string>;
  score: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(quizAttempts).values({
    quizId: data.quizId,
    userId: data.userId,
    answers: data.answers,
    score: data.score,
    completedAt: new Date(),
  });
}

export async function getQuizAttemptsByQuizId(quizId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(quizAttempts).where(
    and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.userId, userId))
  );
}

// ─── Email Draft helpers ─────────────────────────────────────────────────────

export async function createEmailDraft(data: {
  recordingId: number;
  userId: number;
  title: string;
  subject: string;
  content: string;
  draftType?: "email-summary" | "document" | "report";
  tone?: "formal" | "casual" | "technical" | "persuasive";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(emailDrafts).values({
    recordingId: data.recordingId,
    userId: data.userId,
    title: data.title,
    subject: data.subject,
    content: data.content,
    draftType: data.draftType ?? "email-summary",
    tone: data.tone ?? "formal",
    status: "completed",
    generatedAt: new Date(),
  });
  return result;
}

export async function getEmailDraftsByRecordingId(recordingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(emailDrafts).where(eq(emailDrafts.recordingId, recordingId));
}

export async function getEmailDraftById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(emailDrafts).where(eq(emailDrafts.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// Knowledge Base / Search helpers
export async function searchTranscripts(userId: number, query: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const pattern = `%${query}%`;

  // Search across recording titles and transcript content
  const results = await db
    .select({
      recordingId: recordings.id,
      recordingTitle: recordings.title,
      recordingCreatedAt: recordings.createdAt,
      recordingDuration: recordings.duration,
      transcriptId: transcripts.id,
      transcriptContent: transcripts.fullText,
      transcriptStatus: transcripts.status,
    })
    .from(recordings)
    .leftJoin(transcripts, eq(transcripts.recordingId, recordings.id))
    .where(
      and(
        eq(recordings.userId, userId),
        eq(recordings.isDeleted, 0),
        or(
          like(recordings.title, pattern),
          like(transcripts.fullText, pattern)
        )
      )
    )
    .orderBy(desc(recordings.createdAt))
    .limit(50);

  return results;
}
