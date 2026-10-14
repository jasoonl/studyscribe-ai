import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { localIsoDate } from "@shared/actionItems";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Streaks, study time, mastery by course and weak spots (Phase 7). */
export default function Progress() {
  const today = localIsoDate(new Date());
  const { data, isLoading } = trpc.planner.progress.useQuery({ today });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Library
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-4xl pb-20 pt-10" tabIndex={-1}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Progress</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">How much you have studied, and how well the cards are sticking.</p>
          </div>
          <Button asChild className="w-fit">
            <Link href="/plan">Today's plan</Link>
          </Button>
        </div>

        {isLoading || !data ? (
          <div className="flex justify-center py-20" role="status" aria-label="Loading your progress">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {!data.tracking && (
              <p className="mt-8 rounded-xl border border-border bg-brand-mist px-4 py-3 text-sm">
                Streaks and study time are not being recorded on this server yet. Card mastery and quiz scores below still work.
              </p>
            )}

            <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
              <Stat label="Current streak" value={plural(data.streak.current, "day")} note={`Longest ${plural(data.streak.longest, "day")}`} />
              <Stat label="This week" value={plural(data.week.minutes, "minute")} note="Time on flashcards" />
              <Stat
                label="Cards reviewed"
                value={String(data.week.cardsReviewed)}
                note={data.week.cardsReviewed > 0 ? `${Math.round((data.week.remembered / data.week.cardsReviewed) * 100)}% remembered` : "In the last 7 days"}
              />
              <Stat label="Quizzes" value={String(data.week.quizzes)} note="In the last 7 days" />
            </dl>

            <ActivityChart activity={data.activity} />

            <section aria-labelledby="mastery-heading" className="mt-12">
              <h2 id="mastery-heading" className="text-lg font-semibold">Mastery by course</h2>
              <p className="mt-1 text-sm text-muted-foreground">A card counts as mastered once you remember it well enough to be spaced a week or more apart.</p>
              {data.mastery.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No flashcards yet. Make some from a recording to see this.</p>
              ) : (
                <>
                  <MasteryLegend />
                  <ul className="mt-3 space-y-4">
                    {data.mastery.map(row => (
                      <li key={row.courseId ?? "none"}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2 font-medium">
                            {row.color && <CourseDot color={row.color} />}
                            <span className="truncate">{row.name}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {row.mastered} of {row.total} mastered
                          </span>
                        </div>
                        <MasteryBar mastered={row.mastered} learning={row.learning} fresh={row.fresh} total={row.total} name={row.name} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section aria-labelledby="weak-heading" className="mt-12">
              <h2 id="weak-heading" className="text-lg font-semibold">Weak spots</h2>
              {data.weakCards.length === 0 && data.weakQuizzes.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nothing stands out. Cards you forget more than once, and quizzes averaging under 70%, show up here.</p>
              ) : (
                <div className="mt-4 grid gap-6 md:grid-cols-2">
                  {data.weakCards.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cards you keep forgetting</h3>
                      <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
                        {data.weakCards.map(card => (
                          <li key={card.flashcardId} className="px-4 py-3 text-sm">
                            <p className="font-medium">{card.question}</p>
                            <p className="mt-0.5 text-muted-foreground">
                              <Link href={`/recording/${card.recordingId}`} className="underline underline-offset-4 hover:text-foreground">{card.title}</Link>
                              {" · "}forgotten {plural(card.lapses, "time")}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data.weakQuizzes.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quizzes to retake</h3>
                      <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
                        {data.weakQuizzes.map(quiz => (
                          <li key={quiz.recordingId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                            <Link href={`/recordings/${quiz.recordingId}/quizzes`} className="min-w-0 truncate font-medium underline underline-offset-4">{quiz.title}</Link>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {quiz.average}% over {plural(quiz.attempts, "try", "tries")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

/** Cards reviewed per day for four weeks: one series, so one colour and no legend; each bar has its own tooltip. */
function ActivityChart({ activity }: { activity: Array<{ date: string; reviews: number; seconds: number }> }) {
  const max = Math.max(1, ...activity.map(day => day.reviews));
  const total = activity.reduce((sum, day) => sum + day.reviews, 0);
  const activeDays = activity.filter(day => day.reviews > 0).length;
  return (
    <section aria-labelledby="activity-heading" className="mt-12">
      <h2 id="activity-heading" className="text-lg font-semibold">Last four weeks</h2>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {total === 0 ? "No study recorded yet." : `${plural(total, "review")} on ${plural(activeDays, "day")}.`}
      </p>
      <div className="mt-4 flex h-32 items-end gap-0.5 border-b border-border" role="img" aria-label={`Daily study over the last 28 days: ${total} reviews on ${activeDays} days.`}>
        {activity.map(day => {
          const label = `${shortDate(day.date)}: ${plural(day.reviews, "review")}${day.seconds >= 60 ? `, ${Math.round(day.seconds / 60)} min` : ""}`;
          return (
            <div key={day.date} className="group relative flex h-full flex-1 items-end" title={label}>
              <div
                className="w-full rounded-t-[4px] bg-primary"
                style={{ height: day.reviews ? `${Math.max(4, (day.reviews / max) * 100)}%` : 0 }}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background group-hover:block">
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{shortDate(activity[0].date)}</span>
        <span>Today</span>
      </div>
    </section>
  );
}

// One hue, light to dark: new, learning, mastered.
const MASTERY_STEPS = [
  { key: "mastered", label: "Mastered", className: "bg-primary" },
  { key: "learning", label: "Learning", className: "bg-primary/45" },
  { key: "fresh", label: "New", className: "bg-primary/15" },
] as const;

function MasteryLegend() {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {MASTERY_STEPS.map(step => (
        <li key={step.key} className="flex items-center gap-1.5">
          <span aria-hidden className={`inline-block size-2.5 rounded-sm ${step.className}`} />
          {step.label}
        </li>
      ))}
    </ul>
  );
}

function MasteryBar({ mastered, learning, fresh, total, name }: { mastered: number; learning: number; fresh: number; total: number; name: string }) {
  const values = { mastered, learning, fresh };
  return (
    <div
      className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      role="img"
      aria-label={`${name}: ${mastered} mastered, ${learning} learning, ${fresh} new, of ${total} cards.`}
    >
      {MASTERY_STEPS.map(step =>
        values[step.key] > 0 ? (
          <div key={step.key} className={step.className} style={{ width: `${(values[step.key] / total) * 100}%` }} title={`${step.label}: ${values[step.key]}`} />
        ) : null,
      )}
    </div>
  );
}
