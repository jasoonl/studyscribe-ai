import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Bell, BellRing, Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { connectIntegrationUrl } from "@/components/SendToMenu";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const PROMPT_KEY = "studyscribe_calendar_prompt_hidden";
const SHOWN = 5;

type Event = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  reminder: boolean;
};

function dayKey(event: Event) {
  return event.allDay ? event.start : new Date(event.start).toLocaleDateString("en-CA");
}

function dayLabel(key: string, today: string, tomorrow: string) {
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function readHidden() {
  try {
    return localStorage.getItem(PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Dashboard "Upcoming" (A5): the next seven days from Google Calendar, with "Remind me to record". */
export function UpcomingEvents({ onRecord }: { onRecord: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.calendar.upcoming.useQuery(undefined, { staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const setReminder = trpc.calendar.setReminder.useMutation({
    onSuccess: (result) => {
      toast.success(result.reminder ? "We'll remind you when it starts, if StudyScribe is open, and in the morning digest." : "Reminder removed");
      void utils.calendar.upcoming.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const [promptHidden, setPromptHidden] = useState(readHidden);
  const [expanded, setExpanded] = useState(false);
  const now = Date.now();

  const groups = useMemo(() => {
    const events = (data?.events ?? []) as Event[];
    const shown = expanded ? events : events.slice(0, SHOWN);
    const map = new Map<string, Event[]>();
    for (const event of shown) map.set(dayKey(event), [...(map.get(dayKey(event)) ?? []), event]);
    return Array.from(map.entries());
  }, [data?.events, expanded]);

  if (isLoading || !data?.configured) return null;

  if (!data.connected) {
    if (promptHidden) return null;
    return (
      <section aria-label="Calendar" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          <span className="font-medium">See this week's classes here.</span>{" "}
          <span className="text-muted-foreground">Connect Google Calendar to get a reminder to record and recordings named after the class. Read only.</span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              try {
                localStorage.setItem(PROMPT_KEY, "1");
              } catch {
                // Hidden for this visit only.
              }
              setPromptHidden(true);
            }}
          >
            Not now
          </Button>
          <Button size="sm" asChild>
            <a href={connectIntegrationUrl("google_calendar")}>Connect</a>
          </Button>
        </div>
      </section>
    );
  }

  const today = new Date().toLocaleDateString("en-CA");
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA");
  const total = data.events.length;

  return (
    <section aria-labelledby="calendar-heading">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="calendar-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upcoming</h2>
        <Link href="/settings#connected-apps" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
          {data.accountLabel ?? "Google Calendar"}
        </Link>
      </div>
      {data.error ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">{data.error}</p>
      ) : total === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">Nothing on your calendar in the next 7 days.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {groups.map(([key, events]) => (
            <div key={key}>
              <p className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">{dayLabel(key, today, tomorrow)}</p>
              <ul className="divide-y divide-border">
                {events.map((event) => {
                  const start = event.allDay ? null : Date.parse(event.start);
                  const end = event.end && !event.allDay ? Date.parse(event.end) : null;
                  const onNow = start !== null && start - 10 * 60_000 <= now && (end === null || now < end);
                  const canRemind = start !== null && start > now;
                  const pending = setReminder.isPending && setReminder.variables?.eventId === event.id;
                  return (
                    <li key={event.id} className="flex items-center gap-2 px-4 py-3 sm:gap-3">
                      <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground sm:w-20">{event.allDay ? "All day" : time(event.start)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{event.title}</span>
                        {(onNow || event.location) && (
                          <span className={cn("block truncate text-xs", onNow ? "font-medium text-primary" : "text-muted-foreground")}>
                            {onNow ? (start! <= now ? "On now" : "Starting soon") : event.location}
                          </span>
                        )}
                      </span>
                      {onNow ? (
                        <Button size="sm" className="shrink-0 gap-1.5" onClick={onRecord}>
                          <Mic className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Record</span>
                          <span className="sr-only sm:hidden">Record {event.title}</span>
                        </Button>
                      ) : canRemind ? (
                        <Button
                          size="sm"
                          variant={event.reminder ? "secondary" : "ghost"}
                          className="shrink-0 gap-1.5"
                          aria-pressed={event.reminder}
                          disabled={pending}
                          onClick={() => setReminder.mutate({ eventId: event.id, on: !event.reminder, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                        >
                          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : event.reminder ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                          <span className="hidden sm:inline">{event.reminder ? "Reminder on" : "Remind me"}</span>
                          <span className="sr-only sm:hidden">{event.reminder ? "Reminder on" : "Remind me to record"}</span>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {total > SHOWN && (
            <button type="button" onClick={() => setExpanded((value) => !value)} className="w-full border-t border-border px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {expanded ? "Show fewer" : `Show all ${total} events`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
