import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { calendarReminders, integrationConnections, userNotifications } from "../drizzle/schema";
import { getDb } from "./db";
import { accessTokenFor, endpoint, isProviderConfigured } from "./integrations";
import { sendBrowserPush } from "./pushNotifications";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Google Calendar, read only (A5). Shows the next seven days of events from
 * the person's primary calendar on the dashboard, offers "Remind me to
 * record", and suggests the event's name as the title of a recording started
 * while it is on. Events are read from Google when needed and not stored; a
 * reminder keeps a copy of the event's title and times.
 *
 * Reminders and the Hobby plan: Vercel Hobby allows only daily cron jobs, so
 * nothing on the server can wake up at an event's start. Instead:
 *  - while StudyScribe is open in a tab, the page asks every 30 seconds for
 *    reminders that are due (`claimDue`), which marks them sent and delivers
 *    an in-app notification plus browser push to every device the person
 *    enabled; and
 *  - the existing daily cron sends one digest of the next 24 hours of
 *    reminders, so a reminder is never silently lost when no tab is open.
 * A reminder for an event that starts while no StudyScribe tab is open is
 * therefore covered only by that morning's digest.
 */

const HTTP_TIMEOUT_MS = 12_000;
const UPCOMING_DAYS = 7;
const CACHE_MS = 60_000;
/** A recording started up to this long before an event still gets its name. */
export const AUTO_TITLE_LEAD_MS = 10 * 60_000;
/** Reminders fire this early, and are still delivered this late after the start. */
const DUE_LEAD_MS = 60_000;
const DUE_GRACE_MS = 15 * 60_000;

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  meetingUrl: string | null;
};

/**
 * Turns Google's event list into what the dashboard shows. Cancelled events
 * and ones the person declined are dropped; all-day events keep their
 * zone-less dates; the result is sorted by start.
 */
export function parseCalendarEvents(items: unknown): CalendarEvent[] {
  if (!Array.isArray(items)) return [];
  const events: CalendarEvent[] = [];
  for (const item of items as any[]) {
    if (!item || typeof item.id !== "string" || item.status === "cancelled") continue;
    const declined = Array.isArray(item.attendees) && item.attendees.some((attendee: any) => attendee?.self && attendee.responseStatus === "declined");
    if (declined) continue;
    const allDay = typeof item.start?.date === "string" && !item.start?.dateTime;
    const start: string | undefined = allDay ? item.start.date : item.start?.dateTime;
    if (!start || (!allDay && Number.isNaN(Date.parse(start)))) continue;
    const end: string | null = allDay ? (item.end?.date ?? null) : (item.end?.dateTime ?? null);
    const video = Array.isArray(item.conferenceData?.entryPoints) ? item.conferenceData.entryPoints.find((entry: any) => entry?.entryPointType === "video")?.uri : null;
    const meetingUrl = typeof item.hangoutLink === "string" ? item.hangoutLink : typeof video === "string" ? video : null;
    events.push({
      id: item.id,
      title: (typeof item.summary === "string" && item.summary.trim()) || "Untitled event",
      start: allDay ? start : new Date(start).toISOString(),
      end: end && !allDay ? new Date(end).toISOString() : end,
      allDay,
      location: typeof item.location === "string" && item.location.trim() ? item.location.trim() : null,
      meetingUrl: meetingUrl && /^https:\/\//.test(meetingUrl) ? meetingUrl : null,
    });
  }
  return events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * The event a recording started at `at` belongs to: one that is on at that
 * moment, or starts within the next ten minutes (people press Record early).
 * All-day events never name a recording. When two qualify (a class about to
 * end and the next one about to start), an event with more than ten minutes
 * left wins, then the one about to start, then one that is ending.
 */
export function eventForRecordingAt(events: CalendarEvent[], at: Date): CalendarEvent | null {
  const now = at.getTime();
  const ranked = events
    .filter((event) => !event.allDay)
    .map((event) => {
      const start = Date.parse(event.start);
      const end = event.end ? Date.parse(event.end) : start + 60 * 60_000;
      if (!(start - AUTO_TITLE_LEAD_MS <= now && now < end)) return null;
      const rank = start <= now ? (end - now > AUTO_TITLE_LEAD_MS ? 0 : 2) : 1;
      // Within a rank: the most recently started, or the soonest to start.
      return { event, rank, order: rank === 1 ? start - now : now - start };
    })
    .filter((item): item is { event: CalendarEvent; rank: number; order: number } => item !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked[0]?.event ?? null;
}

/** Wording for the daily digest, in the person's own time zone. */
export function buildDigestMessage(reminders: Array<{ title: string; startsAt: Date; timeZone: string | null }>) {
  const time = (reminder: { startsAt: Date; timeZone: string | null }) => {
    try {
      return reminder.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: reminder.timeZone || "UTC", ...(reminder.timeZone ? {} : { timeZoneName: "short" }) });
    } catch {
      return reminder.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
    }
  };
  const list = reminders.slice(0, 4).map((reminder) => `${reminder.title} at ${time(reminder)}`);
  const more = reminders.length > 4 ? `, and ${reminders.length - 4} more` : "";
  return {
    title: reminders.length === 1 ? "1 class to record in the next 24 hours" : `${reminders.length} classes to record in the next 24 hours`,
    body: `${list.join("; ")}${more}. Open StudyScribe when it starts and press Record.`,
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

async function isConnected(userId: number) {
  const db = await requireDb();
  const rows = await tolerateMissingSchema(
    "calendar",
    () => db.select({ id: integrationConnections.id, accountLabel: integrationConnections.accountLabel }).from(integrationConnections).where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "google_calendar"))).limit(1),
    [],
  );
  return rows[0] ?? null;
}

const cache = new Map<string, { at: number; events: CalendarEvent[] }>();

async function fetchEvents(userId: number, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const key = `${userId}:${timeMin.toISOString().slice(0, 16)}:${timeMax.toISOString().slice(0, 13)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events;
  const token = await accessTokenFor(userId, "google_calendar");
  const url = new URL(`${endpoint("google-calendar")}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("fields", "items(id,status,summary,location,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(self,responseStatus))");
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (response.status === 401 || response.status === 403) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google Calendar no longer accepts this connection. Reconnect it in Settings." });
  }
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not read your calendar right now." });
  const body = (await response.json().catch(() => null)) as { items?: unknown } | null;
  const events = parseCalendarEvents(body?.items);
  cache.set(key, { at: Date.now(), events });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return events;
}

async function remindersFor(userId: number, eventIds: string[]) {
  if (!eventIds.length) return new Set<string>();
  const db = await requireDb();
  const rows = await tolerateMissingSchema(
    "calendar",
    () => db.select({ eventId: calendarReminders.eventId }).from(calendarReminders).where(and(eq(calendarReminders.userId, userId), inArray(calendarReminders.eventId, eventIds))),
    [],
  );
  return new Set(rows.map((row) => row.eventId));
}

async function notify(userId: number, note: { title: string; message: string; url: string; tag: string }) {
  const db = await requireDb();
  await db.insert(userNotifications).values({ userId, type: "info", title: note.title.slice(0, 255), message: note.message, isRead: 0 });
  await sendBrowserPush(userId, { title: note.title, body: note.message, url: note.url, tag: note.tag }).catch(() => undefined);
}

/** Reminders that are due for one person now; each is claimed (marked sent) before it is delivered, so two tabs do not both send it. */
export async function claimDueReminders(userId: number, now = new Date()) {
  const db = await requireDb();
  const due = await tolerateMissingSchema(
    "calendar",
    () =>
      db
        .select()
        .from(calendarReminders)
        .where(
          and(
            eq(calendarReminders.userId, userId),
            isNull(calendarReminders.notifiedAt),
            lte(calendarReminders.startsAt, new Date(now.getTime() + DUE_LEAD_MS)),
            gte(calendarReminders.startsAt, new Date(now.getTime() - DUE_GRACE_MS)),
          ),
        )
        .orderBy(asc(calendarReminders.startsAt))
        .limit(10),
    [] as Array<typeof calendarReminders.$inferSelect>,
  );
  const claimed: Array<{ id: number; eventId: string; title: string; startsAt: Date }> = [];
  for (const reminder of due) {
    const result: any = await db.update(calendarReminders).set({ notifiedAt: now }).where(and(eq(calendarReminders.id, reminder.id), isNull(calendarReminders.notifiedAt)));
    const affected = Array.isArray(result) ? result[0]?.affectedRows : result?.affectedRows;
    if (affected === 0) continue;
    claimed.push({ id: reminder.id, eventId: reminder.eventId, title: reminder.title, startsAt: reminder.startsAt });
    await notify(userId, { title: `${reminder.title} is starting`, message: "Time to record. Open StudyScribe and press Record; the recording will be named after the event.", url: "/record", tag: `calendar-${reminder.id}` });
  }
  return claimed;
}

/** Daily cron: one digest per person of the next 24 hours of reminders. */
export async function sendCalendarDigests(now = new Date()) {
  const db = await getDb();
  if (!db) return { users: 0, reminders: 0 };
  const upcoming = await tolerateMissingSchema(
    "calendar",
    () =>
      db
        .select()
        .from(calendarReminders)
        .where(and(isNull(calendarReminders.digestedAt), isNull(calendarReminders.notifiedAt), gte(calendarReminders.startsAt, now), lte(calendarReminders.startsAt, new Date(now.getTime() + 24 * 60 * 60_000))))
        .orderBy(asc(calendarReminders.startsAt))
        .limit(1000),
    [] as Array<typeof calendarReminders.$inferSelect>,
  );
  const byUser = new Map<number, typeof upcoming>();
  for (const row of upcoming) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  for (const [userId, rows] of Array.from(byUser.entries())) {
    const message = buildDigestMessage(rows);
    try {
      await notify(userId, { title: message.title, message: message.body, url: "/dashboard", tag: "calendar-digest" });
    } catch (error) {
      console.error(`[calendar] digest for user ${userId} failed:`, error instanceof Error ? error.message : error);
    }
    await db.update(calendarReminders).set({ digestedAt: now }).where(inArray(calendarReminders.id, rows.map((row) => row.id)));
  }
  // Old reminders are not needed once their event is over.
  await db.delete(calendarReminders).where(lte(calendarReminders.startsAt, new Date(now.getTime() - 7 * 24 * 60 * 60_000))).catch(() => undefined);
  return { users: byUser.size, reminders: upcoming.length };
}

export async function deleteCalendarDataForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema("calendar", () => db.delete(calendarReminders).where(eq(calendarReminders.userId, userId)), undefined);
}

export async function exportCalendarDataForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "calendar",
    async () => (await db.select().from(calendarReminders).where(eq(calendarReminders.userId, userId))).map(({ id, userId: _owner, ...row }) => row),
    [] as Array<Omit<typeof calendarReminders.$inferSelect, "id" | "userId">>,
  );
}

export const calendarRouter = router({
  /** The next seven days, with which events have a reminder. */
  upcoming: protectedProcedure.query(async ({ ctx }) => {
    const configured = isProviderConfigured("google_calendar");
    const connection = configured ? await isConnected(ctx.user.id) : null;
    if (!configured || !connection) return { configured, connected: false as const, accountLabel: null, events: [], error: null };
    const now = new Date();
    try {
      const events = await fetchEvents(ctx.user.id, new Date(now.getTime() - 60 * 60_000), new Date(now.getTime() + UPCOMING_DAYS * 24 * 60 * 60_000));
      const live = events.filter((event) => event.allDay || !event.end || Date.parse(event.end) > now.getTime());
      const reminded = await remindersFor(ctx.user.id, live.map((event) => event.id));
      return { configured, connected: true as const, accountLabel: connection.accountLabel, events: live.map((event) => ({ ...event, reminder: reminded.has(event.id) })), error: null };
    } catch (error) {
      return { configured, connected: true as const, accountLabel: connection.accountLabel, events: [], error: error instanceof Error ? error.message : "Could not read your calendar right now." };
    }
  }),

  /** The event on when a recording started, for its title. Null without a calendar or an event. */
  eventAt: protectedProcedure.input(z.object({ at: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!isProviderConfigured("google_calendar") || !(await isConnected(ctx.user.id))) return null;
    const at = new Date(input.at);
    try {
      const events = await fetchEvents(ctx.user.id, new Date(at.getTime() - 12 * 60 * 60_000), new Date(at.getTime() + 60 * 60_000));
      const event = eventForRecordingAt(events, at);
      return event ? { id: event.id, title: event.title } : null;
    } catch {
      return null;
    }
  }),

  setReminder: protectedProcedure
    .input(z.object({ eventId: z.string().min(1).max(255), on: z.boolean(), timeZone: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      if (!input.on) {
        await explainMissingSchema("Calendar reminders", () => db.delete(calendarReminders).where(and(eq(calendarReminders.userId, ctx.user.id), eq(calendarReminders.eventId, input.eventId))));
        return { reminder: false };
      }
      // Copy the event as Google has it, not as the page sent it.
      const now = new Date();
      const events = await fetchEvents(ctx.user.id, new Date(now.getTime() - 60 * 60_000), new Date(now.getTime() + UPCOMING_DAYS * 24 * 60 * 60_000));
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "That event is no longer in your calendar." });
      if (event.allDay) throw new TRPCError({ code: "BAD_REQUEST", message: "All-day events have no start time to be reminded at." });
      const timeZone = input.timeZone && /^[A-Za-z_+\-/0-9]+$/.test(input.timeZone) ? input.timeZone : null;
      const values = { userId: ctx.user.id, eventId: event.id, title: event.title.slice(0, 255), startsAt: new Date(event.start), endsAt: event.end ? new Date(event.end) : null, timeZone };
      await explainMissingSchema("Calendar reminders", () =>
        db.insert(calendarReminders).values(values).onDuplicateKeyUpdate({ set: { title: values.title, startsAt: values.startsAt, endsAt: values.endsAt, timeZone, notifiedAt: null, digestedAt: null } }),
      );
      return { reminder: true };
    }),

  /** Called by open tabs every 30 seconds: delivers and returns reminders that are due now. */
  claimDue: protectedProcedure.mutation(async ({ ctx }) => ({ reminders: await claimDueReminders(ctx.user.id) })),
});
