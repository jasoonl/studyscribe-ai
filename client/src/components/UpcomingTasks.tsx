import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { daysBetween, describeDueDate, localIsoDate } from "@shared/actionItems";

const SHOWN = 3;

/** On the library: the next few things due, linking to the full task list. Hidden when nothing is due soon. */
export function UpcomingTasks() {
  const { data } = trpc.actionItems.listAll.useQuery();
  const today = localIsoDate(new Date());
  const soon = (data?.items ?? [])
    .filter(item => !item.done && item.dueDate && daysBetween(today, item.dueDate) <= 14)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  if (soon.length === 0) return null;

  return (
    <section aria-labelledby="upcoming-heading" className="mb-6">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="upcoming-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coming up</h2>
        <Link href="/tasks" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
          All tasks{soon.length > SHOWN ? ` (${soon.length} due soon)` : ""}
        </Link>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
        {soon.slice(0, SHOWN).map(item => {
          const overdue = daysBetween(today, item.dueDate!) < 0;
          return (
            <li key={item.id}>
              <Link
                href={item.atSeconds !== null ? `/recording/${item.recordingId}?t=${item.atSeconds}` : `/recording/${item.recordingId}`}
                className="flex items-baseline gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className={cn("w-24 shrink-0 text-sm tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {describeDueDate(item.dueDate!, today)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.text}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.recordingTitle}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
