import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseDot } from "@/components/CourseDot";
import { PracticeStartButton } from "@/components/practice/PracticeSetup";
import { usePracticeCapabilities } from "@/hooks/usePracticeCapabilities";
import { formatDate, formatNumber, t, tn, useI18n } from "@/i18n";
import { openSessions, practicePath } from "@/lib/practiceModel";
import { practiceApi } from "@/lib/practiceTypes";
import { trpc } from "@/lib/trpc";

/** Practice exams: start a timed or untimed exam from a course or exam pack, continue one, see past results. */
export default function Practice() {
  useI18n();
  const capabilities = usePracticeCapabilities();
  const enabled = capabilities.available;
  const sessions = practiceApi.practice.list.useQuery(undefined, { enabled, retry: false, refetchOnWindowFocus: false });
  const courses = trpc.courses.list.useQuery(undefined, { enabled });
  const packs = trpc.examPacks.list.useQuery(undefined, { enabled });

  const items = sessions.data ?? [];
  const open = openSessions(items);
  const done = items.filter(item => item.submittedAt !== null).slice(0, 20);
  const packList = (packs.data?.packs ?? []).filter(pack => pack.questionCount > 0);
  const courseList = (courses.data ?? []).filter(course => !course.archived);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="min-h-11 gap-2">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("common.library")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-24 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("practice.title")}</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("practice.intro")}</p>

        {capabilities.loading ? (
          <div className="flex justify-center py-20" role="status" aria-label={t("common.loading")}>
            <Loader2 className="size-7 animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />
          </div>
        ) : !capabilities.available ? (
          <p className="mt-8 rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">{t("practice.unavailable")}</p>
        ) : (
          <div className="mt-8 space-y-10">
            {open.length > 0 && (
              <section aria-labelledby="practice-open">
                <h2 id="practice-open" className="mb-3 text-lg font-semibold tracking-tight">{t("practice.open")}</h2>
                <ul className="space-y-2">
                  {open.map(item => (
                    <li key={item.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 break-words font-medium">{item.title}</span>
                      <Link href={practicePath(item.id)}>
                        <Button className="min-h-11">{t("practice.continue")}</Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="practice-start">
              <h2 id="practice-start" className="mb-3 text-lg font-semibold tracking-tight">{t("practice.startHeading")}</h2>
              {courses.isLoading || packs.isLoading ? (
                <Loader2 className="size-5 animate-spin text-accent motion-reduce:animate-none" aria-label={t("common.loading")} />
              ) : courseList.length === 0 && packList.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">{t("practice.nothingToStart")}</p>
              ) : (
                <ul className="space-y-2">
                  {courseList.map(course => (
                    <li key={`c${course.id}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="flex min-w-0 items-center gap-2 font-medium">
                        <CourseDot color={course.color} />
                        <span className="min-w-0 break-words">{course.name}</span>
                      </span>
                      <PracticeStartButton target={{ scope: "course", courseId: course.id }} title={course.name} />
                    </li>
                  ))}
                  {packList.map(pack => (
                    <li key={`p${pack.id}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{pack.title}</span>
                        <span className="text-xs text-muted-foreground">{t("practice.packLine", { count: tn("quiz.questions", pack.questionCount) })}</span>
                      </span>
                      <PracticeStartButton target={{ scope: "pack", packId: pack.id }} title={pack.title} questionTotal={pack.questionCount} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">{t("practice.quizHint")}</p>
            </section>

            {done.length > 0 && (
              <section aria-labelledby="practice-past">
                <h2 id="practice-past" className="mb-3 text-lg font-semibold tracking-tight">{t("practice.past")}</h2>
                <ul className="space-y-2">
                  {done.map(item => (
                    <li key={item.id}>
                      <Link
                        href={practicePath(item.id)}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-medium">{item.title}</span>
                          {item.submittedAt && <span className="text-xs text-muted-foreground">{formatDate(item.submittedAt)}</span>}
                        </span>
                        {item.score !== null && <span className="shrink-0 text-lg font-semibold tabular-nums">{formatNumber(item.score)}%</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
