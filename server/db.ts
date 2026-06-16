import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, recordings, transcripts, studyNotes, flashcards, chatHistory } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

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

  return db.select().from(recordings).where(eq(recordings.userId, userId));
}

export async function getRecordingById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(recordings).where(eq(recordings.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
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
