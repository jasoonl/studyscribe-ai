import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { getFlashcardShortcutAction } from "@/lib/flashcardShortcuts";
import { localIsoDate } from "@shared/actionItems";
import { Trans, formatNumber, t, tn, useI18n } from "@/i18n";

const SECONDS_PER_CARD = 30;
/** One sitting at most; a backlog bigger than this is finished in the next session. */
const SESSION_LIMIT = 200;

function examLabel(days: number) {
  return days === 0 ? t("plan.examToday") : days === 1 ? t("plan.examTomorrow") : tn("plan.examInDays", days);
}

/** "3 to review, 5 new." with whichever parts apply. */
function countsLabel(due: number, fresh: number) {
  if (due > 0 && fresh > 0) return t("plan.dueAndFresh", { due: formatNumber(due), fresh: formatNumber(fresh) });
  return due > 0 ? t("plan.dueOnly", { count: formatNumber(due) }) : t("plan.freshOnly", { count: formatNumber(fresh) });
}

/** Today's spaced-repetition plan across every recording, and one review session for all of it (Phase 7). */
export default function StudyPlan() {
  const { t, tn, formatDate } = useI18n();
  const today = localIsoDate(new Date());
  const { data: plan, isLoading } = trpc.planner.today.useQuery({ today });
  const { data: courses } = trpc.courses.list.useQuery();
  const [session, setSession] = useState<number[] | null>(null);
  const courseById = new Map((courses ?? []).map(course => [course.id, course]));
  const dateLabel = formatDate(`${today}T12:00:00`, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("common.library")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("library.plan")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{dateLabel}</p>

        {isLoading || !plan ? (
          <div className="flex justify-center py-20" role="status" aria-label={t("plan.loading")}>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : session ? (
          <ReviewSession ids={session} today={today} onExit={() => setSession(null)} />
        ) : (
          <>
            <Summary plan={plan} onStart={() => setSession(plan.queue.slice(0, SESSION_LIMIT))} />

            {plan.exams.length > 0 && (
              <section aria-labelledby="exams-heading" className="mt-10">
                <h2 id="exams-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("plan.comingUp")}</h2>
                <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
                  {plan.exams.slice(0, 5).map(exam => (
                    <li key={`${exam.recordingId}-${exam.date}-${exam.text}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                      <span className="min-w-0 truncate">{exam.text}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {exam.inDays === 0 ? t("calendar.today") : exam.inDays === 1 ? t("calendar.tomorrow") : tn("plan.inDays", exam.inDays)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.items.length > 0 && (
              <section aria-labelledby="by-recording-heading" className="mt-10">
                <h2 id="by-recording-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("plan.byRecording")}</h2>
                <ul className="mt-3 space-y-2">
                  {plan.items.map(item => {
                    const course = item.courseId !== null ? courseById.get(item.courseId) : undefined;
                    return (
                      <li key={item.recordingId}>
                        <Link
                          href={`/recording/${item.recordingId}`}
                          className="block rounded-xl border border-border bg-card px-4 py-3 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{item.title}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                                {course && (
                                  <span className="flex items-center gap-1.5">
                                    <CourseDot color={course.color} />
                                    {course.name}
                                  </span>
                                )}
                                <span>
                                  {[item.due > 0 && t("plan.toReview", { count: formatNumber(item.due) }), item.fresh > 0 && t("plan.fresh", { count: formatNumber(item.fresh) })].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </span>
                            {item.examInDays !== null && (
                              <span className="shrink-0 rounded-full bg-brand-mist px-2.5 py-1 text-xs font-medium text-primary">{examLabel(item.examInDays)}</span>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <p className="mt-10 text-sm text-muted-foreground">
              <Trans
                k="plan.howItWorks"
                parts={{
                  tasks: text => <Link href="/tasks" className="text-primary underline underline-offset-4">{text}</Link>,
                  progress: text => <Link href="/progress" className="text-primary underline underline-offset-4">{text}</Link>,
                }}
              />
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Summary({ plan, onStart }: { plan: { totalDue: number; totalFresh: number; queue: number[]; totalCards: number }; onStart: () => void }) {
  const { t, tn } = useI18n();
  const total = plan.queue.length;
  if (plan.totalCards === 0) {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold">{t("plan.noCardsTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("plan.noCardsBody")}
        </p>
        <Button asChild variant="outline" className="mt-4 w-fit">
          <Link href="/dashboard">{t("plan.openLibrary")}</Link>
        </Button>
      </Card>
    );
  }
  if (total === 0) {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold">{t("plan.nothingDueTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("plan.nothingDueBody")}</p>
      </Card>
    );
  }
  const minutes = Math.max(1, Math.round((total * SECONDS_PER_CARD) / 60));
  return (
    <Card className="mt-8 gap-0 p-6">
      <h2 className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{tn("plan.cardsToday", total)}</h2>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {countsLabel(plan.totalDue, plan.totalFresh)} {tn("plan.aboutMinutes", minutes)}
      </p>
      <Button className="mt-5 w-fit" size="lg" onClick={onStart}>{t("plan.startReview")}</Button>
      {total > SESSION_LIMIT && (
        <p className="mt-3 text-sm text-muted-foreground">{t("plan.sessionLimit", { count: formatNumber(SESSION_LIMIT) })}</p>
      )}
    </Card>
  );
}

function ReviewSession({ ids, today, onExit }: { ids: number[]; today: string; onExit: () => void }) {
  const { t, tn } = useI18n();
  const utils = trpc.useUtils();
  const { data: cards, isLoading } = trpc.planner.sessionCards.useQuery({ ids });
  const review = trpc.ai.reviewFlashcard.useMutation();
  // Cards missed this session go round once more at the end.
  const [order, setOrder] = useState<number[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState({ knew: 0, again: 0 });
  const retried = useRef(new Set<number>());
  const shownAt = useRef(Date.now());
  const saving = useRef(false);

  const byId = useMemo(() => new Map((cards ?? []).map(card => [card.id, card])), [cards]);
  useEffect(() => {
    if (cards && !order) setOrder(cards.map(card => card.id));
  }, [cards, order]);

  const current = order ? byId.get(order[position]) : undefined;
  useEffect(() => {
    shownAt.current = Date.now();
  }, [position]);

  const grade = async (status: "learning" | "mastered") => {
    if (!current || !order || saving.current) return;
    saving.current = true;
    try {
      await review.mutateAsync({
        recordingId: current.recordingId,
        flashcardId: current.id,
        status,
        seconds: (Date.now() - shownAt.current) / 1000,
        localDate: today,
      });
      setTally(t => (status === "mastered" ? { ...t, knew: t.knew + 1 } : { ...t, again: t.again + 1 }));
      if (status === "learning" && !retried.current.has(current.id)) {
        retried.current.add(current.id);
        setOrder([...order, current.id]);
      }
      setPosition(p => p + 1);
      setRevealed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("plan.saveFailed"));
    } finally {
      saving.current = false;
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = getFlashcardShortcutAction({ key: event.key, isRevealed: revealed, isSubmitting: review.isPending, target: event.target as HTMLElement | null });
      if (!action) return;
      event.preventDefault();
      if (action === "toggle") setRevealed(r => !r);
      else void grade(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const finish = async () => {
    await Promise.all([utils.planner.today.invalidate(), utils.planner.progress.invalidate(), utils.ai.getFlashcardReviews.invalidate()]);
    onExit();
  };

  if (isLoading || !order) {
    return (
      <div className="flex justify-center py-20" role="status" aria-label={t("plan.loadingCards")}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!current) {
    return (
      <Card className="mt-8 p-6" role="status">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">{t("plan.doneTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {tally.again > 0 ? tn("plan.doneKnewAgain", tally.knew, { again: formatNumber(tally.again) }) : tn("plan.doneKnew", tally.knew)}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={finish}>{t("plan.backToPlan")}</Button>
          <Button asChild variant="outline">
            <Link href="/progress">{t("plan.seeProgress")}</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums" aria-live="polite">
          {t("plan.cardOf", { position: formatNumber(position + 1), total: formatNumber(order.length) })}
        </span>
        <Button variant="ghost" size="sm" onClick={finish}>{t("plan.endSession")}</Button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(position / order.length) * 100}%` }} />
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <button
          type="button"
          onClick={() => setRevealed(r => !r)}
          aria-label={revealed ? t("plan.hideAnswer") : t("plan.revealAnswerLabel")}
          className="block min-h-64 w-full p-6 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
        >
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{revealed ? t("cards.answer") : t("cards.question")}</span>
          <span className="mt-3 block text-xl font-semibold leading-relaxed sm:text-2xl">{revealed ? current.answer : current.question}</span>
        </button>
      </Card>

      {revealed ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="outline" size="lg" onClick={() => grade("learning")} disabled={review.isPending}>
            {t("plan.stillLearning")}
          </Button>
          <Button size="lg" onClick={() => grade("mastered")} disabled={review.isPending}>
            {t("plan.knewIt")}
          </Button>
        </div>
      ) : (
        <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>{t("cards.revealAnswer")}</Button>
      )}
      <p className="hidden text-center text-xs text-muted-foreground sm:block">{t("plan.shortcuts")}</p>
    </div>
  );
}
