import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
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
  isDeleted: int("isDeleted").default(0).notNull(), // Soft delete flag
  deletedAt: timestamp("deletedAt"), // Timestamp when deleted
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  recordingId: int("recordingId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  keyPoints: json("keyPoints").$type<string[]>().default([]), // Array of key points
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating"),
  generatedAt: timestamp("generatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  }>>().default([]),
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating"),
  generatedAt: timestamp("generatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  answers: json("answers").$type<Record<string, string>>().default({}), // Question ID -> Answer
  score: int("score"), // Percentage score
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailDraft = typeof emailDrafts.$inferSelect;
export type EmailDraftTone = "formal" | "casual" | "technical" | "persuasive";
export type InsertEmailDraft = typeof emailDrafts.$inferInsert;
