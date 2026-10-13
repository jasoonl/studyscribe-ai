import { describe, expect, it } from "vitest";
import { buildDigestMessage, eventForRecordingAt, parseCalendarEvents } from "./calendar";
import { buildAuthorizeUrl, GOOGLE_CALENDAR_SCOPE, redirectUri } from "./integrations";

const google = [
  { id: "late", status: "confirmed", summary: "Chemistry 210", start: { dateTime: "2026-10-14T15:00:00-04:00" }, end: { dateTime: "2026-10-14T16:15:00-04:00" }, location: "Hall B" },
  { id: "early", status: "confirmed", summary: "Biology 101", start: { dateTime: "2026-10-14T09:00:00-04:00" }, end: { dateTime: "2026-10-14T10:00:00-04:00" }, hangoutLink: "https://meet.google.com/abc-defg-hij" },
  { id: "allday", status: "confirmed", summary: "Reading week", start: { date: "2026-10-15" }, end: { date: "2026-10-16" } },
  { id: "gone", status: "cancelled", summary: "Cancelled seminar", start: { dateTime: "2026-10-14T11:00:00Z" }, end: { dateTime: "2026-10-14T12:00:00Z" } },
  { id: "nope", status: "confirmed", summary: "Optional talk", start: { dateTime: "2026-10-14T12:00:00Z" }, end: { dateTime: "2026-10-14T13:00:00Z" }, attendees: [{ self: true, responseStatus: "declined" }] },
  { id: "untitled", status: "confirmed", start: { dateTime: "2026-10-16T08:00:00Z" }, conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://zoom.us/j/1" }] } },
  { id: "broken", status: "confirmed", summary: "No start" },
  null,
];

describe("calendar events", () => {
  const events = parseCalendarEvents(google);

  it("drops cancelled, declined and malformed events and sorts by start", () => {
    expect(events.map((event) => event.id)).toEqual(["early", "late", "allday", "untitled"]);
  });

  it("normalises times, keeps all-day dates, and finds the meeting link", () => {
    const [early, late, allDay, untitled] = events;
    expect(early).toMatchObject({ title: "Biology 101", start: "2026-10-14T13:00:00.000Z", end: "2026-10-14T14:00:00.000Z", allDay: false, meetingUrl: "https://meet.google.com/abc-defg-hij" });
    expect(late.location).toBe("Hall B");
    expect(allDay).toMatchObject({ allDay: true, start: "2026-10-15", end: "2026-10-16" });
    expect(untitled).toMatchObject({ title: "Untitled event", end: null, meetingUrl: "https://zoom.us/j/1" });
  });

  it("returns nothing for a response without items", () => {
    expect(parseCalendarEvents(undefined)).toEqual([]);
    expect(parseCalendarEvents({})).toEqual([]);
  });
});

describe("naming a recording after the event", () => {
  const events = parseCalendarEvents(google);

  it("uses the event that is on, or starts within ten minutes", () => {
    expect(eventForRecordingAt(events, new Date("2026-10-14T13:30:00Z"))?.title).toBe("Biology 101");
    expect(eventForRecordingAt(events, new Date("2026-10-14T12:52:00Z"))?.title).toBe("Biology 101");
    expect(eventForRecordingAt(events, new Date("2026-10-14T12:45:00Z"))).toBeNull();
    expect(eventForRecordingAt(events, new Date("2026-10-14T14:00:00Z"))).toBeNull();
  });

  it("prefers the class that is on over the next one, unless the first is about to end", () => {
    const back = parseCalendarEvents([
      { id: "a", summary: "Biology 101", start: { dateTime: "2026-10-14T09:00:00Z" }, end: { dateTime: "2026-10-14T10:00:00Z" } },
      { id: "b", summary: "Chemistry 210", start: { dateTime: "2026-10-14T10:00:00Z" }, end: { dateTime: "2026-10-14T11:00:00Z" } },
    ]);
    expect(eventForRecordingAt(back, new Date("2026-10-14T09:30:00Z"))?.title).toBe("Biology 101");
    expect(eventForRecordingAt(back, new Date("2026-10-14T09:49:00Z"))?.title).toBe("Biology 101");
    expect(eventForRecordingAt(back, new Date("2026-10-14T09:55:00Z"))?.title).toBe("Chemistry 210");
  });

  it("never uses an all-day event, and treats an event without an end as an hour long", () => {
    expect(eventForRecordingAt(events, new Date("2026-10-15T12:00:00Z"))).toBeNull();
    expect(eventForRecordingAt(events, new Date("2026-10-16T08:59:00Z"))?.title).toBe("Untitled event");
    expect(eventForRecordingAt(events, new Date("2026-10-16T09:01:00Z"))).toBeNull();
  });
});

describe("daily digest", () => {
  it("lists reminders in each person's own time zone", () => {
    const message = buildDigestMessage([
      { title: "Biology 101", startsAt: new Date("2026-10-14T13:00:00Z"), timeZone: "America/New_York" },
      { title: "Chemistry 210", startsAt: new Date("2026-10-14T19:00:00Z"), timeZone: "America/New_York" },
    ]);
    expect(message.title).toBe("2 classes to record in the next 24 hours");
    expect(message.body).toMatch(/^Biology 101 at 9:00 AM; Chemistry 210 at 3:00 PM\./);
  });

  it("falls back to UTC, labelled, when no time zone was saved or it is invalid", () => {
    expect(buildDigestMessage([{ title: "Lab", startsAt: new Date("2026-10-14T13:00:00Z"), timeZone: null }]).body).toMatch(/Lab at 1:00 PM UTC/);
    expect(buildDigestMessage([{ title: "Lab", startsAt: new Date("2026-10-14T13:00:00Z"), timeZone: "Not/AZone" }]).body).toMatch(/Lab at 1:00 PM UTC/);
  });

  it("summarises long days", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `Class ${i}`, startsAt: new Date(Date.UTC(2026, 9, 14, 8 + i)), timeZone: "UTC" }));
    expect(buildDigestMessage(many).body).toMatch(/Class 3 at 11:00 AM, and 2 more\./);
  });
});

describe("Google Calendar connection", () => {
  it("asks for read-only calendar access and comes back to its own callback", () => {
    const url = new URL(buildAuthorizeUrl("google_calendar", "client", "https://app.example", "st"));
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPE);
    expect(GOOGLE_CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.readonly");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/integrations/google-calendar/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(redirectUri("google_drive", "https://app.example")).toBe("https://app.example/api/integrations/google/callback");
  });
});
