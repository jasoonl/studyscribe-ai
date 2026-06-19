import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json } from "drizzle-orm/mysql-core";

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
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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