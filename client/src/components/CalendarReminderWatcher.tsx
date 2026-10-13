import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import type { useRecorder } from "@/contexts/RecorderContext";
import { trpc } from "@/lib/trpc";

const POLL_MS = 30_000;

/**
 * Delivers "Remind me to record" reminders at the event's start while
 * StudyScribe is open (A5). Vercel Hobby crons run once a day, so this tab is
 * what notices the start time: it asks the server every 30 seconds, and the
 * server sends the in-app notification and browser push once. Mounted only on
 * signed-in pages, and only polls when Google Calendar is connected.
 */
export function CalendarReminderWatcher() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data } = trpc.integrations.status.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const claim = trpc.calendar.claimDue.useMutation();
  const claimRef = useRef(claim.mutateAsync);
  claimRef.current = claim.mutateAsync;
  const connected = !!data?.calendar?.connected;

  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const tick = async () => {
      try {
        const { reminders } = await claimRef.current();
        if (stopped || reminders.length === 0) return;
        for (const reminder of reminders) {
          toast(`${reminder.title} is starting`, {
            id: `calendar-${reminder.id}`,
            description: "Press Record and the recording will be named after it.",
            duration: 60_000,
            action: { label: "Record", onClick: () => navigate("/record") },
          });
        }
        void utils.userNotifications.invalidate();
      } catch {
        // A missed check is retried on the next tick.
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [connected, navigate, utils]);

  return null;
}

/**
 * Names a new recording after the calendar event it was started in (A5).
 * Fills the title only while it is empty and the person has not typed one,
 * and says where it came from.
 */
export function useCalendarTitle(recorder: ReturnType<typeof useRecorder>, title: string, setTitle: (value: string) => void) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const filledFor = useRef<number | null>(null);
  const active = recorder.status !== "idle";

  useEffect(() => {
    if (!active) {
      setStartedAt(null);
      return;
    }
    if (startedAt === null) setStartedAt(Date.now() - recorder.getElapsedSeconds() * 1000);
  }, [active, startedAt, recorder]);

  const { data: event } = trpc.calendar.eventAt.useQuery({ at: startedAt ?? 1 }, { enabled: startedAt !== null, staleTime: Infinity, retry: false, refetchOnWindowFocus: false });

  useEffect(() => {
    if (!event || startedAt === null || filledFor.current === startedAt || title.trim()) return;
    filledFor.current = startedAt;
    setTitle(event.title);
  }, [event, startedAt, title, setTitle]);

  return event && title === event.title ? `Named after "${event.title}" in your calendar.` : null;
}

/** The calendar event a recording belongs to, and when it started, for linking it on save (D4). */
export function useCalendarEventForRecording(recorder: ReturnType<typeof useRecorder>) {
  const active = recorder.status !== "idle";
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setStartedAt(null);
      return;
    }
    if (startedAt === null) setStartedAt(Date.now() - recorder.getElapsedSeconds() * 1000);
  }, [active, startedAt, recorder]);
  const { data: event } = trpc.calendar.eventAt.useQuery({ at: startedAt ?? 1 }, { enabled: startedAt !== null, staleTime: Infinity, retry: false, refetchOnWindowFocus: false });
  return event && startedAt ? { calendarEventId: event.id, startedAt } : {};
}
