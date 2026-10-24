import { forwardRef } from "react";
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, useI18n } from "@/i18n";
import { formatClock } from "@/lib/practiceClock";
import { correctItems, missedItems } from "@/lib/practiceModel";
import type { PracticeOrigin, PracticeOutcome, PracticeQuestion } from "@/lib/practiceTypes";
import { MissedQuestionReview } from "./MissedQuestionReview";
import { PracticeMissedButton } from "./PracticeMissedButton";

/** Score, time used, then every missed question with its explanation and the ones that were right. */
export const ExamResults = forwardRef<
  HTMLDivElement,
  {
    questions: PracticeQuestion[];
    outcome: PracticeOutcome;
    origin: PracticeOrigin;
    timeLimitSeconds: number | null;
    extraTime: number | null | undefined;
    explanations: boolean;
    /** Practice sets can be built from the missed questions. */
    canPracticeMissed: boolean;
  }
>(function ExamResults({ questions, outcome, origin, timeLimitSeconds, extraTime, explanations, canPracticeMissed }, ref) {
  const { t } = useI18n();
  const missed = missedItems(questions, outcome.results);
  const right = correctItems(questions, outcome.results);
  const unanswered = outcome.results.filter(result => !result.userAnswer.trim()).length;

  return (
    <div className="space-y-8">
      <div ref={ref} tabIndex={-1} className="rounded-xl border border-border bg-card p-5 shadow-sm outline-none sm:p-6">
        <h2 className="text-sm font-medium text-muted-foreground">{t("practice.results.score")}</h2>
        <p className="mt-1 text-5xl font-bold tracking-tight tabular-nums">{formatNumber(outcome.score)}%</p>
        <p className="mt-1 text-muted-foreground">{t("quiz.scoreCorrect", { correct: outcome.correct, total: outcome.total })}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {timeLimitSeconds ? (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("practice.results.timeUsed")}</dt>
              <dd className="font-medium tabular-nums">{t("practice.results.timeOf", { used: formatClock(outcome.secondsUsed), limit: formatClock(timeLimitSeconds) })}</dd>
            </div>
          ) : null}
          {unanswered > 0 && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("practice.results.unanswered")}</dt>
              <dd className="font-medium tabular-nums">{formatNumber(unanswered)}</dd>
            </div>
          )}
        </dl>
        {outcome.autoSubmitted && <p className="mt-3 text-sm" role="status">{t("practice.results.timeUp")}</p>}
        {extraTime && extraTime > 1 && <p className="mt-1 text-sm text-muted-foreground">{t(extraTime === 1.25 ? "practice.results.extra25" : "practice.results.extra50")}</p>}
      </div>

      {missed.length === 0 ? (
        <p className="flex items-center gap-2 text-sm font-medium" role="status">
          <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
          {t("practice.results.allRight")}
        </p>
      ) : (
        <>
          {canPracticeMissed && <PracticeMissedButton origin={origin} allowSimilar={explanations} />}
          <MissedQuestionReview origin={origin} items={missed} explanations={explanations} />
        </>
      )}

      {right.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("practice.results.rightSummary", { count: formatNumber(right.length) })}
          </summary>
          <ol className="mt-3 space-y-3">
            {right.map(item => (
              <li key={item.question.id} className="text-sm">
                <p className="text-xs tabular-nums text-muted-foreground">{t("quiz.questionNumber", { number: item.number })}</p>
                <p className="font-medium">{item.question.question}</p>
                <p className="text-primary">{item.result.correctAnswer}</p>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/practice">
          <Button variant="outline" className="min-h-11">{t("practice.results.back")}</Button>
        </Link>
      </div>
    </div>
  );
});
