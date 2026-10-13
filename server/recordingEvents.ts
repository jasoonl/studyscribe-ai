import { eq, inArray } from "drizzle-orm";
import { recordingEvents, type RecordingEvent } from "../drizzle/schema";
import { getDb } from "./db";
import { tolerateMissingSchema } from "./schemaTolerance";

/**
 * Which calendar event or bot meeting a recording came from, with the
 * attendees at the time (D4). Only used to offer the owner to email the notes
 * to those attendees; never shown to anyone else.
 */

export type Attendee = { email: string; name: string | null };

export const MAX_STORED_ATTENDEES = 100;

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** Clean, de-duplicated attendees, without the owner's own address. */
export function normalizeAttendees(list: unknown, ownerEmail?: string | null): Attendee[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const owner = ownerEmail?.trim().toLowerCase();
  const out: Attendee[] = [];
  for (const item of list as any[]) {
    const email = typeof item?.email === "string" ? item.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !EMAIL.test(email) || email === owner || seen.has(email)) continue;
    seen.add(email);
    const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim().slice(0, 120) : null;
    out.push({ email, name });
    if (out.length >= MAX_STORED_ATTENDEES) break;
  }
  return out;
}

export function parseStoredAttendees(text: string | null | undefined): Attendee[] {
  if (!text) return [];
  try {
    return normalizeAttendees(JSON.parse(text));
  } catch {
    return [];
  }
}

export async function linkRecordingEvent(input: {
  recordingId: number;
  userId: number;
  source: "calendar" | "meeting_bot";
  eventId: string | null;
  title: string;
  startsAt: Date | null;
  attendees: Attendee[];
}) {
  const db = await getDb();
  if (!db) return;
  const values = {
    recordingId: input.recordingId,
    userId: input.userId,
    source: input.source,
    eventId: input.eventId?.slice(0, 255) ?? null,
    title: input.title.slice(0, 255),
    startsAt: input.startsAt,
    attendees: JSON.stringify(input.attendees.slice(0, MAX_STORED_ATTENDEES)),
  };
  await tolerateMissingSchema(
    "recording events",
    () => db.insert(recordingEvents).values(values).onDuplicateKeyUpdate({ set: { eventId: values.eventId, title: values.title, startsAt: values.startsAt, attendees: values.attendees } }),
    undefined,
  );
}

export async function getRecordingEvent(recordingId: number): Promise<RecordingEvent | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await tolerateMissingSchema("recording events", () => db.select().from(recordingEvents).where(eq(recordingEvents.recordingId, recordingId)).limit(1), [] as RecordingEvent[]);
  return rows[0] ?? null;
}

export async function deleteRecordingEventsForRecordings(recordingIds: number[]) {
  if (!recordingIds.length) return;
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("recording events", () => db.delete(recordingEvents).where(inArray(recordingEvents.recordingId, recordingIds)), undefined);
}

export async function deleteRecordingEventsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("recording events", () => db.delete(recordingEvents).where(eq(recordingEvents.userId, userId)), undefined);
}

export async function exportRecordingEventsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await tolerateMissingSchema("recording events", () => db.select().from(recordingEvents).where(eq(recordingEvents.userId, userId)), [] as RecordingEvent[]);
  return rows.map((row) => ({ recordingId: row.recordingId, source: row.source, title: row.title, startsAt: row.startsAt, attendees: parseStoredAttendees(row.attendees) }));
}
