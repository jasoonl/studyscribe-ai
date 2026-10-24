import { Link } from "wouter";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { canRetry, citationView, practiceErrorKey, type ExplainState } from "@/lib/practiceModel";
import type { AskCitation } from "@/lib/askSources";

/** Citation chips: a recording opens at the cited time, a file at the cited page. */
export function ExplanationCitations({ citations }: { citations: AskCitation[] }) {
  const { t } = useI18n();
  if (citations.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("ask.sources")}>
      {citations.map(citation => {
        const view = citationView(citation, t);
        const phrase =
          view.kind === "source"
            ? t("ask.cite.openSource", { title: view.title, place: view.where || t("ask.cite.wholeSource") })
            : t("ask.cite.openRecording", { title: view.title, place: view.where || t("ask.cite.wholeRecording") });
        return (
          <li key={view.n} className="min-w-0 max-w-full">
            <Link
              href={view.href}
              title={view.snippet}
              aria-label={phrase}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-1.5 pr-3 text-xs transition-colors hover:border-primary/50 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">{view.n}</span>
              {view.kind === "source" && <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="truncate font-medium text-foreground">{view.title}</span>
              {view.where && <span className="shrink-0 tabular-nums text-muted-foreground">{view.where}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The explanation area under one missed question. The wrapper is always present and polite so
 * an explanation that arrives is read out without moving focus.
 */
export function ExplanationCard({
  number,
  state,
  canExplain,
  onExplain,
}: {
  number: number;
  state: ExplainState;
  canExplain: boolean;
  onExplain: () => void;
}) {
  const { t } = useI18n();
  return (
    <div aria-live="polite" className="mt-4">
      {state.status === "idle" && canExplain && (
        <Button variant="outline" className="min-h-11" onClick={onExplain} aria-label={t("mistakes.explainFor", { number })}>
          {t("mistakes.explain")}
        </Button>
      )}
      {state.status === "loading" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4" role="status">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("mistakes.writing")}
          </p>
          <div className="h-3 w-full rounded bg-muted" aria-hidden="true" />
          <div className="h-3 w-4/5 rounded bg-muted" aria-hidden="true" />
        </div>
      )}
      {state.status === "ready" && (
        <section aria-label={t("mistakes.explanationLabel", { number })} className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{state.text}</p>
          <ExplanationCitations citations={state.citations} />
        </section>
      )}
      {state.status === "notCovered" && (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t("mistakes.notCovered")}</p>
      )}
      {state.status === "error" && (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-destructive">{t(practiceErrorKey(state.kind))}</p>
          {canRetry(state.kind) && (
            <Button variant="outline" className="min-h-11 shrink-0" onClick={onExplain} aria-label={t("mistakes.retryFor", { number })}>
              {t("mistakes.retry")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
