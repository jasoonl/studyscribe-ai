import { localIsoDate } from "@shared/actionItems";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExamResults } from "@/components/practice/ExamResults";
import { ExamTimer } from "@/components/practice/ExamTimer";
import { QuestionCard } from "@/components/practice/QuestionCard";
import { usePracticeCapabilities } from "@/hooks/usePracticeCapabilities";
import { formatNumber, t, useI18n } from "@/i18n";
import { clockOffset, retryDelayMs } from "@/lib/practiceClock";
import {
  answeredCount, clearDraft, mergeDraft, practiceErrorKind, pruneAnswers, readDraft, sameAnswers, writeDraft, type PracticeErrorKind,
} from "@/lib/practiceModel";
import { practiceApi, type PracticeOutcome, type PracticeSessionData } from "@/lib/practiceTypes";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "failed";

function Runner({
  session,
  offsetMs,
  onOffset,
  onSubmitted,
}: {
  session: PracticeSessionData;
  offsetMs: number;
  onOffset: (offset: number) => void;
  onSubmitted: (outcome: PracticeOutcome) => void;
}) {
  useI18n();
  const { questions } = session;
  const timed = session.mode === "timed" && session.deadlineAt !== null && session.timeLimitSeconds !== null;
  // Starting answers: what the server saved, with anything newer typed on this device on top.
  const [answers, setAnswers] = useState(() => pruneAnswers(questions, mergeDraft(session.answers, readDraft(session.id))));
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<PracticeErrorKind | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [, navigate] = useLocation();

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const lastSaved = useRef(session.answers);
  const saving = useRef(false);
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const firstIndex = useRef(true);

  const save = practiceApi.practice.saveAnswers.useMutation();
  const submit = practiceApi.practice.submit.useMutation();
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;
  const submitRef = useRef(submit.mutateAsync);
  submitRef.current = submit.mutateAsync;
  const onOffsetRef = useRef(onOffset);
  onOffsetRef.current = onOffset;
  const onSubmittedRef = useRef(onSubmitted);
  onSubmittedRef.current = onSubmitted;

  const saveNow = useCallback(async () => {
    const snapshot = answersRef.current;
    if (saving.current || submittingRef.current || sameAnswers(lastSaved.current, snapshot)) return;
    saving.current = true;
    if (mounted.current) setSaveState("saving");
    let saved = false;
    try {
      const sentAt = performance.now();
      const reply = await saveRef.current({ sessionId: session.id, answers: snapshot });
      const receivedAt = performance.now();
      lastSaved.current = snapshot;
      saved = true;
      if (reply?.savedAt) onOffsetRef.current(clockOffset(new Date(reply.savedAt).getTime(), receivedAt, receivedAt - sentAt));
      if (mounted.current) setSaveState("saved");
    } catch {
      // The copy on this device keeps the answers; the next change or reconnect saves again.
      if (mounted.current) setSaveState("failed");
    } finally {
      saving.current = false;
    }
    // Edits made while this save was in flight are not lost: send them right after.
    if (saved && mounted.current && !sameAnswers(lastSaved.current, answersRef.current)) void saveNow();
  }, [session.id]);

  // Keep a copy on this device at once; send it to the server after a short pause.
  useEffect(() => {
    writeDraft(session.id, answers);
    if (sameAnswers(lastSaved.current, answers)) return;
    const timer = window.setTimeout(() => void saveNow(), 5000);
    return () => window.clearTimeout(timer);
  }, [answers, session.id, saveNow]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saveNow();
    };
    const online = () => void saveNow();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("online", online);
    };
  }, [saveNow]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving the page: send what is typed, so the server copy is current.
      if (!submittingRef.current && !sameAnswers(lastSaved.current, answersRef.current)) {
        void saveRef.current({ sessionId: session.id, answers: answersRef.current }).catch(() => undefined);
      }
    };
  }, [session.id]);

  // Move focus to the question when the person changes question (not on first load).
  useEffect(() => {
    if (firstIndex.current) {
      firstIndex.current = false;
      return;
    }
    cardRef.current?.focus();
  }, [index]);

  const submitNow = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    for (let attempt = 0; ; attempt++) {
      try {
        const outcome = await submitRef.current({ sessionId: session.id, answers: answersRef.current, localDate: localIsoDate(new Date()) });
        clearDraft(session.id);
        onSubmittedRef.current(outcome);
        return;
      } catch (error) {
        const kind = practiceErrorKind(error);
        // Offline or the server is busy: keep the answers and try again, slower each time.
        if ((kind === "network" || kind === "timeout") && mounted.current) {
          setSubmitError(kind);
          await new Promise(resolve => window.setTimeout(resolve, retryDelayMs(attempt)));
          if (!mounted.current) break;
          continue;
        }
        if (mounted.current) setSubmitError(kind);
        break;
      }
    }
    submittingRef.current = false;
    if (mounted.current) setSubmitting(false);
  }, [session.id]);

  const onExpire = useCallback(() => {
    setExpired(true);
    void submitNow();
  }, [submitNow]);

  const count = answeredCount(questions, answers);
  const question = questions[Math.min(index, questions.length - 1)];
  const locked = submitting || expired;
  const setAnswer = (id: string, value: string) => setAnswers(current => ({ ...current, [id]: value }));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex min-h-16 items-center justify-between gap-3 py-2">
          <Button variant="ghost" size="sm" className="min-h-11 gap-2" onClick={() => setConfirmLeave(true)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{t("practice.leave")}</span>
          </Button>
          {timed && session.deadlineAt && session.timeLimitSeconds ? (
            <ExamTimer deadlineMs={new Date(session.deadlineAt).getTime()} offsetMs={offsetMs} totalSeconds={session.timeLimitSeconds} onExpire={onExpire} />
          ) : (
            <span className="text-sm text-muted-foreground">{t("practice.untimed")}</span>
          )}
        </div>
        <div className="container pb-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{t("examPack.answeredCount", { answered: formatNumber(count), total: formatNumber(questions.length) })}</span>
            <span aria-live="polite" className="tabular-nums">
              {saveState === "saving" ? t("practice.save.saving") : saveState === "saved" ? t("practice.save.saved") : saveState === "failed" ? t("practice.save.failed") : ""}
            </span>
          </div>
          <Progress value={questions.length ? (count / questions.length) * 100 : 0} className="mt-1 h-1.5" aria-hidden="true" />
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-24 pt-8" tabIndex={-1}>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{session.title}</h1>

        {(expired || submitting) && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm" role="status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {expired ? t("practice.timeUpSubmitting") : t("practice.submitting")}
          </p>
        )}
        {submitError && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive/40 p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <p className="text-sm text-destructive">{t(submitError === "network" || submitError === "timeout" ? "practice.submitRetrying" : "practice.submitFailed")}</p>
            {!submitting && (
              <Button variant="outline" className="min-h-11 shrink-0" onClick={() => void submitNow()}>
                {t("mistakes.retry")}
              </Button>
            )}
          </div>
        )}

        <div ref={cardRef} tabIndex={-1} className="mt-6 outline-none" aria-label={t("quiz.questionNumber", { number: index + 1 })}>
          <QuestionCard
            key={question.id}
            question={question}
            number={index + 1}
            total={questions.length}
            value={answers[question.id] ?? ""}
            onChange={value => setAnswer(question.id, value)}
            onBlur={() => void saveNow()}
            disabled={locked}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="outline" className="min-h-11" disabled={index === 0 || locked} onClick={() => setIndex(index - 1)}>
            {t("cards.previous")}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={index >= questions.length - 1 || locked} onClick={() => setIndex(index + 1)}>
            {t("cards.next")}
          </Button>
        </div>

        <nav aria-label={t("practice.questionList")} className="mt-6">
          <ol className="flex flex-wrap gap-2">
            {questions.map((entry, i) => {
              const done = (answers[entry.id] ?? "").trim() !== "";
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={locked}
                    aria-current={i === index ? "step" : undefined}
                    aria-label={t(done ? "practice.nav.answered" : "practice.nav.unanswered", { number: i + 1 })}
                    onClick={() => setIndex(i)}
                    className={cn(
                      "size-11 rounded-full border text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      i === index ? "border-primary bg-primary text-primary-foreground" : done ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="mt-8">
          <Button className="min-h-11 w-full sm:w-auto" disabled={locked} onClick={() => (count < questions.length ? setConfirmSubmit(true) : void submitNow())}>
            {t("practice.submit")}
          </Button>
        </div>
      </main>

      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("practice.confirmSubmit.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("practice.confirmSubmit.text", { count: formatNumber(questions.length - count) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("practice.confirmSubmit.keep")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void submitNow()}>{t("practice.submit")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("practice.confirmLeave.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t(timed ? "practice.confirmLeave.timed" : "practice.confirmLeave.untimed")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("practice.confirmLeave.stay")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => navigate("/practice")}>{t("practice.leave")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * wouter keeps this component mounted when only the address's `:id` changes (finishing an exam
 * and opening the "missed" set, for example), so everything that belongs to one exam lives in
 * a child keyed by the id: its result, its clock and its focus never leak into the next one.
 */
export default function PracticeSession() {
  const [, params] = useRoute("/practice/:id");
  const id = params?.id && /^\d+$/.test(params.id) ? Number.parseInt(params.id, 10) : NaN;
  return <PracticeSessionView key={Number.isNaN(id) ? "none" : id} id={id} />;
}

function PracticeSessionView({ id }: { id: number }) {
  useI18n();
  const valid = Number.isInteger(id) && id > 0;
  const capabilities = usePracticeCapabilities();
  const query = practiceApi.practice.get.useQuery({ sessionId: id }, { enabled: valid, retry: false, refetchOnWindowFocus: false });
  const session = query.data;
  const [outcome, setOutcome] = useState<PracticeOutcome | null>(null);
  const [liveOffset, setLiveOffset] = useState<number | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // The server's time at arrival (plus half the round trip) against the monotonic clock, so a
  // changed device clock cannot move the countdown. A newer fetch replaces a save's estimate.
  const fetchStart = useRef<number | null>(null);
  useEffect(() => {
    if (query.fetchStatus === "fetching") fetchStart.current = performance.now();
  }, [query.fetchStatus]);
  const fetchedOffset = useMemo(() => {
    if (!session) return 0;
    const received = performance.now();
    const rtt = fetchStart.current === null ? 0 : received - fetchStart.current;
    return clockOffset(new Date(session.serverNow).getTime(), received, rtt);
  }, [session?.serverNow, query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setLiveOffset(null), [query.dataUpdatedAt]);
  const offsetMs = liveOffset ?? fetchedOffset;

  // Coming back to the tab asks the server for its time again, so the clock is checked often enough.
  const isOpen = session?.status === "open" && !outcome;
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  useEffect(() => {
    if (!isOpen) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetchRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isOpen]);

  const finalOutcome = outcome ?? session?.result ?? null;
  const finished = finalOutcome !== null || session?.status === "submitted";
  // Answer text does not stay on the device once the exam is over, however it was submitted.
  useEffect(() => {
    if (finished && valid) clearDraft(id);
  }, [finished, valid, id]);
  useEffect(() => {
    if (finalOutcome) requestAnimationFrame(() => resultsRef.current?.focus());
  }, [finalOutcome !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const errorKind = query.error ? practiceErrorKind(query.error) : null;

  if (!valid || errorKind === "notFound") {
    return <Message title={t("practice.notFound")} text={t("practice.notFoundText")} />;
  }
  if (query.isLoading) {
    return (
      <main id="main-content" className="container max-w-3xl pt-10" tabIndex={-1}>
        <h1 className="sr-only">{t("practice.loading")}</h1>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-6 h-64 w-full rounded-xl" />
      </main>
    );
  }
  if (query.error || !session) {
    return (
      <Message
        title={t("practice.loadFailed")}
        text={t(errorKind === "notSetUp" ? "practice.error.notSetUp" : "practice.error.network")}
        action={errorKind === "notSetUp" ? undefined : <Button className="min-h-11" onClick={() => void query.refetch()}>{t("mistakes.retry")}</Button>}
      />
    );
  }

  if (finalOutcome || session.status === "submitted") {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b border-border bg-background">
          <div className="container flex h-16 items-center">
            <Link href="/practice">
              <Button variant="ghost" size="sm" className="min-h-11 gap-2">
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("practice.title")}
              </Button>
            </Link>
          </div>
        </header>
        <main id="main-content" className="container max-w-3xl pb-24 pt-10" tabIndex={-1}>
          <h1 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">{session.title}</h1>
          {finalOutcome ? (
            <ExamResults
              ref={resultsRef}
              questions={session.questions}
              outcome={finalOutcome}
              origin={{ sessionId: session.id }}
              timeLimitSeconds={session.timeLimitSeconds}
              extraTime={session.extraTime}
              explanations={capabilities.explanations}
              canPracticeMissed={capabilities.available}
            />
          ) : (
            <p className="text-muted-foreground">{t("practice.noResult")}</p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Runner
        key={session.id}
        session={session}
        offsetMs={offsetMs}
        onOffset={setLiveOffset}
        onSubmitted={result => {
          setOutcome(result);
          void query.refetch();
        }}
      />
    </div>
  );
}

function Message({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="container max-w-md py-24 text-center" tabIndex={-1}>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mb-6 text-muted-foreground">{text}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {action}
          <Link href="/practice"><Button variant="outline" className="min-h-11">{t("practice.results.back")}</Button></Link>
        </div>
      </main>
    </div>
  );
}
