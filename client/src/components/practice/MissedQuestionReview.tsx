import { useEffect, useReducer, useRef, useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, tn, useI18n } from "@/i18n";
import { offerUpgradeOnUsageLimit } from "@/lib/usageLimit";
import {
  explainReducer,
  nextToExplain,
  originKey,
  practiceErrorKind,
  stopsExplainAll,
  type ExplainStates,
  type PracticeErrorKind,
  type ReviewItem,
} from "@/lib/practiceModel";
import { practiceApi, type PracticeOrigin } from "@/lib/practiceTypes";
import { ExplanationCard } from "./ExplanationCard";

/**
 * Every wrong answer with the right one beside it. When the server can write explanations
 * each question has its own "Explain why" button, so a request (and its cost) follows
 * curiosity; explanations already written for this origin show straight away.
 */
export function MissedQuestionReview({
  origin,
  items,
  explanations,
}: {
  origin: PracticeOrigin;
  items: ReviewItem[];
  explanations: boolean;
}) {
  const { t } = useI18n();
  const [states, dispatch] = useReducer(explainReducer, {} as ExplainStates);
  const statesRef = useRef(states);
  statesRef.current = states;
  const asking = useRef(new Set<string>());
  const stopAll = useRef(false);
  const mounted = useRef(true);
  const [allRunning, setAllRunning] = useState(false);
  const [allDone, setAllDone] = useState(0);
  const explain = practiceApi.mistakes.explain.useMutation();
  const explainRef = useRef(explain.mutateAsync);
  explainRef.current = explain.mutateAsync;
  const key = originKey(origin);

  const stored = practiceApi.mistakes.list.useQuery({ origin }, { enabled: explanations, retry: false, refetchOnWindowFocus: false, gcTime: 0 });
  const seededAt = useRef(0);
  const storedRef = useRef(stored.data);
  storedRef.current = stored.data;
  useEffect(() => {
    // Only a list fetched since this review opened counts: a cached one may belong to an earlier attempt.
    if (!stored.isFetchedAfterMount || stored.isFetching || !stored.dataUpdatedAt || stored.dataUpdatedAt === seededAt.current || !storedRef.current) return;
    seededAt.current = stored.dataUpdatedAt;
    dispatch({ type: "seed", stored: storedRef.current });
  }, [stored.dataUpdatedAt, stored.isFetchedAfterMount, stored.isFetching]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopAll.current = true;
    };
  }, []);

  /** Asks about one question. Returns the failure kind, or null on success. */
  const explainOne = async (item: ReviewItem): Promise<PracticeErrorKind | null> => {
    const id = item.question.id;
    if (asking.current.has(id)) return null;
    asking.current.add(id);
    dispatch({ type: "load", id });
    try {
      const output = await explainRef.current({ origin, questionId: id, userAnswer: item.result.userAnswer });
      dispatch({ type: "done", id, output });
      return null;
    } catch (error) {
      const kind = practiceErrorKind(error);
      if (kind === "usageLimit") offerUpgradeOnUsageLimit(error);
      dispatch({ type: "fail", id, kind, message: error instanceof Error ? error.message : "" });
      return kind;
    } finally {
      asking.current.delete(id);
    }
  };

  const explainAll = async () => {
    stopAll.current = false;
    setAllRunning(true);
    setAllDone(0);
    // Each question is tried once per run, so a failing one cannot be retried in a loop.
    const tried = new Set<string>();
    try {
      for (;;) {
        if (stopAll.current) break;
        const item = nextToExplain(items, statesRef.current, tried);
        if (!item) break;
        tried.add(item.question.id);
        const failure = await explainOne(item);
        if (mounted.current) setAllDone(tried.size);
        if (failure && stopsExplainAll(failure)) break;
      }
    } finally {
      if (mounted.current) setAllRunning(false);
    }
  };

  const idleCount = items.filter(item => {
    const state = states[item.question.id];
    return !state || state.status === "idle";
  }).length;
  const anyReady = items.some(item => states[item.question.id]?.status === "ready");
  const unavailableForAll = items.length > 0 && Object.values(states).some(state => state.status === "error" && state.kind === "notSetUp");

  if (items.length === 0) return null;

  return (
    <section aria-labelledby={`missed-${key}`} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={`missed-${key}`} className="text-lg font-semibold tracking-tight">
          {t("mistakes.title")} <span className="font-normal text-muted-foreground tabular-nums">({tn("mistakes.count", items.length)})</span>
        </h2>
        {explanations && items.length > 1 && !unavailableForAll && (
          allRunning ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {t("mistakes.explainingProgress", { done: formatNumber(allDone), total: formatNumber(items.length) })}
              </span>
              <Button variant="outline" className="min-h-11" onClick={() => (stopAll.current = true)}>
                {t("mistakes.stop")}
              </Button>
            </div>
          ) : (
            idleCount > 0 && (
              <Button variant="outline" className="min-h-11 self-start" onClick={() => void explainAll()}>
                {t("mistakes.explainAll")}
              </Button>
            )
          )
        )}
      </div>

      <ol className="space-y-4">
        {items.map(item => {
          const state = states[item.question.id] ?? { status: "idle" as const };
          const answer = item.result.userAnswer.trim();
          return (
            <li key={item.question.id} className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs tabular-nums text-muted-foreground">{t("quiz.questionNumber", { number: item.number })}</p>
                  <p className="mt-1 text-sm font-medium leading-snug">{item.question.question}</p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                      <dt className="shrink-0 text-muted-foreground">{t("cards.yourAnswer")}</dt>
                      <dd className="min-w-0 break-words text-destructive">{answer || <em className="text-muted-foreground">{t("quiz.notAnswered")}</em>}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                      <dt className="shrink-0 text-muted-foreground">{t("cards.correctAnswer")}</dt>
                      <dd className="min-w-0 break-words font-medium text-primary">{item.result.correctAnswer}</dd>
                    </div>
                  </dl>
                  {explanations && <ExplanationCard number={item.number} state={state} canExplain onExplain={() => void explainOne(item)} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {explanations && anyReady && <p className="text-xs text-muted-foreground">{t("mistakes.disclaimer")}</p>}
    </section>
  );
}
