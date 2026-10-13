import { sql } from "drizzle-orm";
import { boolean, customType, date, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** MEDIUMTEXT (16MB): webhook payload snapshots can outgrow TEXT's 64KB. */
const mediumText = customType<{ data: string }>({
  dataType() {
    return "mediumtext";
  },
});

/**
 * Raw bytes (MySQL/MariaDB/TiDB BLOB, 64KB). Embeddings are stored as
 * little-endian float32 arrays here rather than in a TiDB VECTOR column, so the
 * same schema runs on plain MySQL and MariaDB; ranking happens in Node.
 */
const bytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "blob";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value as any);
  },
});

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Email address - unique identifier for custom auth */
  email: varchar("email", { length: 320 }).notNull().unique(),
  /** Password hash for email/password login (bcrypt) */
  passwordHash: text("passwordHash"),
  /** Google OAuth ID */
  googleId: varchar("googleId", { length: 255 }).unique(),
  /** Manus OAuth identifier (kept for backwards compatibility) */
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  /** Login method used: 'email', 'google', or 'manus' */
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Whether email is verified */
  emailVerified: int("emailVerified").default(0).notNull(),
  /** When the person accepted the Terms of Service and Privacy Policy (null for accounts made before they existed). */
  termsAcceptedAt: timestamp("termsAcceptedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Recordings table — stores metadata for audio recordings
 */
export const recordings = mysqlTable("recordings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  audioUrl: text("audioUrl").notNull(), // S3 storage URL
  audioKey: varchar("audioKey", { length: 512 }).notNull(), // S3 storage key
  duration: int("duration"), // Duration in seconds
  audience: mysqlEnum("audience", ["student", "professional"]).default("student"),
  status: mysqlEnum("status", ["processing", "completed", "failed"]).default("processing"),
  transcriptionProviderId: varchar("transcriptionProviderId", { length: 128 }).unique(),
  publicShareToken: varchar("publicShareToken", { length: 64 }).unique(), // Set when the owner has an active public share link
  isDeleted: int("isDeleted").default(0).notNull(), // Soft delete flag
  deletedAt: timestamp("deletedAt"), // Timestamp when deleted
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type Recording = typeof recordings.$inferSelect;
export type InsertRecording = typeof recordings.$inferInsert;

/**
 * Transcripts table — stores full transcription with timestamps
 */
export const transcripts = mysqlTable("transcripts", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  fullText: text("fullText").notNull(), // Complete transcript
  segments: json("segments").$type<Array<{
    id: string;
    start: number; // Timestamp in seconds
    end: number;
    text: string;
    speaker?: string;
    confidence?: number;
  }>>(), // Timestamped segments
  language: varchar("language", { length: 10 }).default("en"),
  status: mysqlEnum("status", ["processing", "completed", "failed"]).default("processing"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type Transcript = typeof transcripts.$inferSelect;
export type InsertTranscript = typeof transcripts.$inferInsert;

/**
 * Study notes table — AI-generated summaries and notes
 */
export const studyNotes = mysqlTable("studyNotes", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["summary", "key_concepts", "action_items", "formulas", "study_guide"]).notNull(),
  content: text("content").notNull(),
  metadata: json("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type StudyNote = typeof studyNotes.$inferSelect;
export type InsertStudyNote = typeof studyNotes.$inferInsert;

/**
 * Flashcards table — auto-generated flashcards from transcripts
 */
export const flashcards = mysqlTable("flashcards", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  difficulty: mysqlEnum("difficulty", ["easy", "medium", "hard"]).default("medium"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type Flashcard = typeof flashcards.$inferSelect;
export type InsertFlashcard = typeof flashcards.$inferInsert;

/**
 * Flashcard review state — tracks a learner's active-recall progress for a card.
 */
export const flashcardReviews = mysqlTable("flashcardReviews", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  flashcardId: int("flashcardId").notNull(),
  recordingId: int("recordingId").notNull(),
  status: mysqlEnum("status", ["new", "learning", "mastered"]).default("new").notNull(),
  reviewCount: int("reviewCount").default(0).notNull(),
  lastReviewedAt: timestamp("lastReviewedAt"),
  masteredAt: timestamp("masteredAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("flashcardReviews_user_flashcard_unique").on(table.userId, table.flashcardId),
]);

export type FlashcardReview = typeof flashcardReviews.$inferSelect;
export type InsertFlashcardReview = typeof flashcardReviews.$inferInsert;

/**
 * AI chat history table — stores conversations with AI tutor
 */
export const chatHistory = mysqlTable("chatHistory", {
  id: int("id").autoincrement().primaryKey(),
  /** Null for "Ask StudyScribe" questions, which span recordings instead of belonging to one. */
  recordingId: int("recordingId"),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type ChatMessage = typeof chatHistory.$inferSelect;

/**
 * Tags table — user-defined tags for organizing recordings and notes
 */
export const tags = mysqlTable("tags", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).default("#3B82F6"), // Hex color
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type Tag = typeof tags.$inferSelect;
export type InsertTag = typeof tags.$inferInsert;

/**
 * Recording tags junction table — many-to-many relationship
 */
export const recordingTags = mysqlTable("recordingTags", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  tagId: int("tagId").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type RecordingTag = typeof recordingTags.$inferSelect;
export type InsertRecordingTag = typeof recordingTags.$inferInsert;

/**
 * Note tags junction table — many-to-many relationship
 */
export const noteTags = mysqlTable("noteTags", {
  id: int("id").autoincrement().primaryKey(),
  noteId: int("noteId").notNull(),
  tagId: int("tagId").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type NoteTag = typeof noteTags.$inferSelect;
export type InsertNoteTag = typeof noteTags.$inferInsert;

export type InsertChatMessage = typeof chatHistory.$inferInsert;

/**
 * User notifications table — stores notifications for users
 */
export const userNotifications = mysqlTable("userNotifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["info", "success", "warning", "error"]).default("info"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  recordingId: int("recordingId"), // Optional: link to a recording
  isRead: int("isRead").default(0).notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = typeof userNotifications.$inferInsert;

/**
 * Web Push subscriptions — encrypted browser endpoints owned by an authenticated user.
 * Only the endpoint hash is indexed, which avoids indexing a potentially long endpoint URL.
 */
export const pushSubscriptions = mysqlTable("pushSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  endpoint: varchar("endpoint", { length: 768 }).notNull(),
  endpointHash: varchar("endpointHash", { length: 64 }).notNull(),
  p256dh: varchar("p256dh", { length: 255 }).notNull(),
  auth: varchar("auth", { length: 255 }).notNull(),
  expirationTime: timestamp("expirationTime"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("pushSubscriptions_endpoint_hash_unique").on(table.endpointHash),
  index("pushSubscriptions_user_id_idx").on(table.userId),
]);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

/**
 * Invite codes table — for invite-only signup system
 */
export const inviteCodes = mysqlTable("inviteCodes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull(),
  createdBy: int("createdBy").notNull(), // Admin who created the invite
  usedBy: int("usedBy"), // User who used the invite
  isUsed: int("isUsed").default(0).notNull(),
  usedAt: timestamp("usedAt"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = typeof inviteCodes.$inferInsert;

/**
 * Password reset tokens table — for password recovery
 */
export const passwordResetTokens = mysqlTable("passwordResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

/**
 * Invite requests table — stores access requests from prospective users
 */
export const inviteRequests = mysqlTable("inviteRequests", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  reason: text("reason"), // Why they want access
  status: mysqlEnum("status", ["pending", "approved", "denied"]).default("pending").notNull(),
  inviteCodeId: int("inviteCodeId"), // Set when approved
  reviewedBy: int("reviewedBy"), // Admin who reviewed
  reviewedAt: timestamp("reviewedAt"),
  reviewNote: text("reviewNote"), // Admin note on approval/denial
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type InviteRequest = typeof inviteRequests.$inferSelect;
export type InsertInviteRequest = typeof inviteRequests.$inferInsert;

/**
 * Study Guides table — AI-generated study guides from transcripts
 */
export const studyGuides = mysqlTable("studyGuides", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(), // Markdown formatted study guide
  keyPoints: json("keyPoints").$type<string[]>(), // Array of key points
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating"),
  generatedAt: timestamp("generatedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type StudyGuide = typeof studyGuides.$inferSelect;
export type InsertStudyGuide = typeof studyGuides.$inferInsert;

/**
 * Quizzes table — AI-generated practice quizzes from transcripts
 */
export const quizzes = mysqlTable("quizzes", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  questions: json("questions").$type<Array<{
    id: string;
    question: string;
    type: "multiple-choice" | "short-answer";
    options?: string[];
    correctAnswer: string;
    explanation: string;
  }>>(),
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating"),
  generatedAt: timestamp("generatedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type Quiz = typeof quizzes.$inferSelect;
export type InsertQuiz = typeof quizzes.$inferInsert;

/**
 * Quiz Attempts table — Track user quiz attempts and scores
 */
export const quizAttempts = mysqlTable("quizAttempts", {
  id: int("id").autoincrement().primaryKey(),
  quizId: int("quizId").notNull(),
  userId: int("userId").notNull(),
  answers: json("answers").$type<Record<string, string>>(), // Question ID -> Answer
  score: int("score"), // Percentage score
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type InsertQuizAttempt = typeof quizAttempts.$inferInsert;

/**
 * Email Drafts table — AI-generated email summaries and documents
 */
export const emailDrafts = mysqlTable("emailDrafts", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  content: text("content").notNull(), // Email body in markdown
  draftType: mysqlEnum("draftType", ["email-summary", "document", "report"]).default("email-summary"),
  tone: mysqlEnum("tone", ["formal", "casual", "technical", "persuasive"]).default("formal"),
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating"),
  generatedAt: timestamp("generatedAt"),
  sentAt: timestamp("sentAt"), // When email was sent (if applicable)
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
});

export type EmailDraft = typeof emailDrafts.$inferSelect;
export type EmailDraftTone = "formal" | "casual" | "technical" | "persuasive";
export type InsertEmailDraft = typeof emailDrafts.$inferInsert;

/**
 * Recording shares table — grants a specific registered account access to a
 * recording at a role (view, comment or edit) (transcript, notes, flashcards, quizzes, study
 * guides). Independent of `recordings.publicShareToken`, which is a
 * no-login public link instead of a targeted share.
 */
export const recordingShares = mysqlTable("recordingShares", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  ownerId: int("ownerId").notNull(),
  sharedWithUserId: int("sharedWithUserId").notNull(),
  sharedWithEmail: varchar("sharedWithEmail", { length: 320 }).notNull(),
  /**
   * What the recipient may do (D3): view, comment on the transcript, or also
   * edit it. Added by migration 0022; until it runs, reads fall back to
   * "view" (see server/recordingAccess.ts).
   */
  role: mysqlEnum("role", ["view", "comment", "edit"]).default("view").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("recordingShares_recording_user_unique").on(table.recordingId, table.sharedWithUserId),
]);

export type RecordingShare = typeof recordingShares.$inferSelect;
export type InsertRecordingShare = typeof recordingShares.$inferInsert;

/**
 * Moments the user marked while recording ("Mark moment") or while listening
 * back, in seconds from the start of the audio.
 */
export const recordingBookmarks = mysqlTable("recordingBookmarks", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  atSeconds: int("atSeconds").notNull(),
  label: varchar("label", { length: 120 }),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("recordingBookmarks_recording_idx").on(table.recordingId),
]);

export type RecordingBookmark = typeof recordingBookmarks.$inferSelect;

/** Small server-owned key/value settings (e.g. the YouTube relay's current tunnel address). Never exposed to clients. */
export const appSettings = mysqlTable("appSettings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

/**
 * Courses (folders) a student files recordings under. Archiving hides a
 * course from the sidebar-style lists but keeps its recordings assigned.
 * `color` is a key from shared/courseColors.ts, not a CSS value.
 */
export const courses = mysqlTable("courses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  color: varchar("color", { length: 16 }).default("blue").notNull(),
  term: varchar("term", { length: 64 }),
  archived: boolean("archived").default(false).notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("courses_user_idx").on(table.userId),
]);

export type Course = typeof courses.$inferSelect;

/**
 * Which course a recording belongs to (at most one). This is a table of its
 * own rather than a `recordings.courseId` column so that a server which has
 * not run the migration yet keeps loading recordings: an unknown column on
 * `recordings` would break every query against it, an unknown table only
 * turns courses off.
 */
export const recordingCourses = mysqlTable("recordingCourses", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  courseId: int("courseId").notNull(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("recordingCourses_recording_unique").on(table.recordingId),
  index("recordingCourses_course_idx").on(table.courseId),
]);

export type RecordingCourse = typeof recordingCourses.$inferSelect;

/**
 * Tasks, assignments and deadlines pulled out of a transcript ("Find tasks"),
 * plus any the person adds by hand. `dueDate` is a calendar day with no time
 * zone (YYYY-MM-DD); `dueText` keeps how it was said ("next Friday") so a
 * worked-out date can be checked against the recording.
 */
export const actionItems = mysqlTable("actionItems", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  recordingId: int("recordingId").notNull(),
  text: varchar("text", { length: 500 }).notNull(),
  kind: mysqlEnum("kind", ["task", "assignment", "exam", "reading"]).default("task").notNull(),
  owner: varchar("owner", { length: 120 }),
  dueDate: date("dueDate", { mode: "string" }),
  dueText: varchar("dueText", { length: 120 }),
  atSeconds: int("atSeconds"),
  source: mysqlEnum("source", ["extracted", "manual"]).default("extracted").notNull(),
  done: boolean("done").default(false).notNull(),
  doneAt: timestamp("doneAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("actionItems_user_idx").on(table.userId),
  index("actionItems_recording_idx").on(table.recordingId),
]);

export type ActionItem = typeof actionItems.$inferSelect;
export type InsertActionItem = typeof actionItems.$inferInsert;

/**
 * Words the transcription provider should listen for (names, course jargon).
 * One row per person with `recordingId` null holds the list used for every
 * recording; a row with a `recordingId` holds extra terms for that one only.
 * `terms` is newline-separated.
 */
export const vocabularyLists = mysqlTable("vocabularyLists", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  recordingId: int("recordingId"),
  terms: text("terms").notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  index("vocabularyLists_user_idx").on(table.userId),
]);

export type VocabularyList = typeof vocabularyLists.$inferSelect;

/**
 * A combined study guide and practice quiz made from several recordings (often
 * a whole course) for exam revision. The guide and the quiz are generated in
 * separate requests so neither request has to fit two model calls; either is
 * null until it has been generated.
 */
export const examPacks = mysqlTable("examPacks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  courseId: int("courseId"),
  recordingIds: json("recordingIds").$type<number[]>().notNull(),
  guide: text("guide"),
  questions: json("questions").$type<Array<{
    id: string;
    question: string;
    type: "multiple-choice" | "short-answer";
    options?: string[];
    correctAnswer: string;
    explanation: string;
    recordingId?: number;
  }>>(),
  lastScore: int("lastScore"),
  attempts: int("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("examPacks_user_idx").on(table.userId),
]);

export type ExamPack = typeof examPacks.$inferSelect;

/**
 * Follow-up suggestions after a recording (C7): a few dated study steps such
 * as "Review these concepts tomorrow". Regenerating replaces the open ones.
 * `remindedAt` is set once the daily reminder for the item has gone out.
 */
export const followUpSuggestions = mysqlTable("followUpSuggestions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  recordingId: int("recordingId").notNull(),
  kind: mysqlEnum("kind", ["review", "practice", "ask", "read"]).default("review").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  detail: varchar("detail", { length: 500 }),
  dueDate: date("dueDate", { mode: "string" }).notNull(),
  done: boolean("done").default(false).notNull(),
  doneAt: timestamp("doneAt"),
  remindedAt: timestamp("remindedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("followUpSuggestions_user_idx").on(table.userId),
  index("followUpSuggestions_recording_idx").on(table.recordingId),
]);

export type FollowUpSuggestion = typeof followUpSuggestions.$inferSelect;

/**
 * Highlights and comments on transcript lines (B7). Each row anchors to one
 * transcript segment by index (and id, as a check) plus character offsets in
 * that segment's text; `quote` keeps the selected words so a thread still makes
 * sense if the text is edited later. Replies point at their thread's root with
 * `parentId`; only roots carry `resolved`.
 */
export const transcriptAnnotations = mysqlTable("transcriptAnnotations", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  authorId: int("authorId").notNull(),
  parentId: int("parentId"),
  kind: mysqlEnum("kind", ["highlight", "comment"]).default("comment").notNull(),
  segmentIndex: int("segmentIndex").notNull(),
  segmentId: varchar("segmentId", { length: 64 }),
  startOffset: int("startOffset").notNull(),
  endOffset: int("endOffset").notNull(),
  quote: varchar("quote", { length: 500 }).notNull(),
  body: text("body"),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedBy: int("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  index("transcriptAnnotations_recording_idx").on(table.recordingId),
  index("transcriptAnnotations_author_idx").on(table.authorId),
]);

export type TranscriptAnnotation = typeof transcriptAnnotations.$inferSelect;

/** Study groups (D2). `joinToken` is the secret in the join link; null when the link is turned off. */
export const studyGroups = mysqlTable("studyGroups", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  joinToken: varchar("joinToken", { length: 64 }).unique(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("studyGroups_owner_idx").on(table.ownerId),
]);

export type StudyGroup = typeof studyGroups.$inferSelect;

export const studyGroupMembers = mysqlTable("studyGroupMembers", {
  id: int("id").autoincrement().primaryKey(),
  groupId: int("groupId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "member"]).default("member").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("studyGroupMembers_group_user_unique").on(table.groupId, table.userId),
  index("studyGroupMembers_user_idx").on(table.userId),
]);

/**
 * A recording or a whole course shared to a group, at a role. A course share
 * covers every recording filed under the course, including ones added later.
 */
export const groupShares = mysqlTable("groupShares", {
  id: int("id").autoincrement().primaryKey(),
  groupId: int("groupId").notNull(),
  sharedBy: int("sharedBy").notNull(),
  itemType: mysqlEnum("itemType", ["recording", "course"]).notNull(),
  itemId: int("itemId").notNull(),
  role: mysqlEnum("role", ["view", "comment", "edit"]).default("view").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("groupShares_group_item_unique").on(table.groupId, table.itemType, table.itemId),
  index("groupShares_item_idx").on(table.itemType, table.itemId),
]);

export type GroupShare = typeof groupShares.$inferSelect;

/**
 * Transcript passages with their embedding (C2) for semantic search in Ask.
 * `contentHash` is a hash of the transcript the chunks were made from, so an
 * edited transcript is re-embedded; `model` lets a model change re-embed too.
 */
export const transcriptChunks = mysqlTable("transcriptChunks", {
  id: int("id").autoincrement().primaryKey(),
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  chunkIndex: int("chunkIndex").notNull(),
  startSeconds: int("startSeconds"),
  text: text("text").notNull(),
  embedding: bytes("embedding").notNull(),
  model: varchar("model", { length: 120 }).notNull(),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("transcriptChunks_recording_idx").on(table.recordingId),
  index("transcriptChunks_user_idx").on(table.userId),
]);

export type TranscriptChunk = typeof transcriptChunks.$inferSelect;

/** Outgoing webhooks (E4): a person's endpoints. `secret` is encrypted at rest (server/tokenCrypto.ts). */
export const webhookEndpoints = mysqlTable("webhookEndpoints", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  description: varchar("description", { length: 120 }),
  /** Comma-separated event names from shared/webhooks.ts. */
  events: varchar("events", { length: 255 }).notNull(),
  secret: text("secret").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("webhookEndpoints_user_idx").on(table.userId),
]);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

/** One event sent (or being retried) to one endpoint. */
export const webhookDeliveries = mysqlTable("webhookDeliveries", {
  id: int("id").autoincrement().primaryKey(),
  endpointId: int("endpointId").notNull(),
  userId: int("userId").notNull(),
  event: varchar("event", { length: 64 }).notNull(),
  deliveryId: varchar("deliveryId", { length: 64 }).notNull(),
  payload: mediumText("payload").notNull(),
  status: mysqlEnum("status", ["pending", "succeeded", "failed"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  responseStatus: int("responseStatus"),
  error: varchar("error", { length: 500 }),
  nextAttemptAt: timestamp("nextAttemptAt"),
  lastAttemptAt: timestamp("lastAttemptAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("webhookDeliveries_endpoint_idx").on(table.endpointId),
  index("webhookDeliveries_user_idx").on(table.userId),
  index("webhookDeliveries_due_idx").on(table.status, table.nextAttemptAt),
]);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

/**
 * OAuth connections to export destinations (E3). Tokens are encrypted at rest
 * with a key derived from INTEGRATIONS_ENCRYPTION_KEY (or JWT_SECRET).
 */
export const integrationConnections = mysqlTable("integrationConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["notion", "google_drive", "google_calendar"]).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: timestamp("expiresAt"),
  accountLabel: varchar("accountLabel", { length: 255 }),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("integrationConnections_user_provider_unique").on(table.userId, table.provider),
]);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;

/**
 * Phase 5 billing (F2). One row per person who has started a checkout. Only
 * Stripe identifiers and the subscription state Stripe reports are kept; card
 * details never reach this server. `lastEventAt` is the `created` time of the
 * newest Stripe event applied, so an older event delivered late cannot undo a
 * newer state.
 */
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  stripePriceId: varchar("stripePriceId", { length: 255 }),
  planId: varchar("planId", { length: 16 }).default("free").notNull(),
  status: varchar("status", { length: 32 }).default("none").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  lastEventAt: int("lastEventAt").default(0).notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("subscriptions_user_unique").on(table.userId),
  uniqueIndex("subscriptions_customer_unique").on(table.stripeCustomerId),
  index("subscriptions_subscription_idx").on(table.stripeSubscriptionId),
]);

export type Subscription = typeof subscriptions.$inferSelect;

/** Stripe event ids already handled, so a redelivered webhook is applied once. */
export const stripeEvents = mysqlTable("stripeEvents", {
  id: varchar("id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 64 }).notNull(),
  processedAt: timestamp("processedAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

/**
 * Monthly usage ledger (F2). `period` is the UTC calendar month (`YYYY-MM`).
 * Transcription rows hold seconds of audio, AI rows hold 1 per generation.
 * `dedupeKey` makes a charge happen once (a recording's transcription is
 * counted once however many times it is retried or its webhook redelivered);
 * MySQL allows any number of NULLs in a unique index.
 */
export const usageEvents = mysqlTable("usageEvents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  period: varchar("period", { length: 7 }).notNull(),
  kind: mysqlEnum("kind", ["transcription", "ai_generation"]).notNull(),
  units: int("units").notNull(),
  recordingId: int("recordingId"),
  dedupeKey: varchar("dedupeKey", { length: 191 }),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("usageEvents_user_period_idx").on(table.userId, table.period),
  uniqueIndex("usageEvents_dedupe_unique").on(table.dedupeKey),
]);

export type UsageEvent = typeof usageEvents.$inferSelect;

/**
 * Stored machine translations (F7), one row per chunk so a long transcript is
 * translated across many short requests. `sourceHash` is the hash of the
 * chunk's source text: an edit to the source makes the row stale.
 */
export const translations = mysqlTable("translations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  kind: mysqlEnum("kind", ["transcript", "guide", "note"]).notNull(),
  itemId: int("itemId").notNull(),
  recordingId: int("recordingId"),
  language: varchar("language", { length: 10 }).notNull(),
  chunkIndex: int("chunkIndex").notNull(),
  sourceHash: varchar("sourceHash", { length: 64 }).notNull(),
  content: mediumText("content").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("translations_item_chunk_unique").on(table.kind, table.itemId, table.language, table.chunkIndex),
  index("translations_user_idx").on(table.userId),
  index("translations_recording_idx").on(table.recordingId),
]);

export type Translation = typeof translations.$inferSelect;

/**
 * "Remind me to record" for a Google Calendar event (A5). The event's title
 * and times are copied when the reminder is set; events themselves are read
 * from Google on demand and not stored.
 */
export const calendarReminders = mysqlTable("calendarReminders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  eventId: varchar("eventId", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  // An explicit default keeps servers with explicit_defaults_for_timestamp=OFF
  // from adding ON UPDATE CURRENT_TIMESTAMP to the first NOT NULL timestamp.
  startsAt: timestamp("startsAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
  endsAt: timestamp("endsAt"),
  /** The person's IANA time zone when they set the reminder, for the daily digest's wording. */
  timeZone: varchar("timeZone", { length: 64 }),
  notifiedAt: timestamp("notifiedAt"),
  digestedAt: timestamp("digestedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("calendarReminders_user_event_unique").on(table.userId, table.eventId),
  index("calendarReminders_starts_idx").on(table.startsAt),
]);

export type CalendarReminder = typeof calendarReminders.$inferSelect;

/**
 * Personal API keys (E5). Only a SHA-256 hash of the key is stored; the key
 * itself is shown once when it is made. `prefix` is the first characters, so
 * people can tell their keys apart. `scope` is "read" or "write" (write also
 * reads). Revoked keys keep their row for the record and stop working.
 */
export const apiKeys = mysqlTable("apiKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  prefix: varchar("prefix", { length: 16 }).notNull(),
  keyHash: varchar("keyHash", { length: 64 }).notNull(),
  scope: mysqlEnum("scope", ["read", "write"]).default("read").notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  requestCount: int("requestCount").default(0).notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("apiKeys_hash_unique").on(table.keyHash),
  index("apiKeys_user_idx").on(table.userId),
]);

export type ApiKey = typeof apiKeys.$inferSelect;
