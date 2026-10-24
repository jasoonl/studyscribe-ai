import { Link } from "wouter";
import { FileText } from "lucide-react";
import { citationLink, type AskCitation } from "@/lib/askSources";
import { formatLocation } from "@/lib/sourceLocation";
import { formatTimestamp } from "@shared/timestamp";
import { useI18n } from "@/i18n";

export type AnswerMeta = {
  citations: AskCitation[];
  /** Recordings with a match. */
  searched: number;
  searchedSources?: number;
  retrieval?: "keyword" | "hybrid";
  askedSources: boolean;
  askedRecordings: boolean;
};

/** Citations under an answer, as real links: a source opens at its page, a recording at its moment. */
export function CitationChips({ meta }: { meta: AnswerMeta }) {
  const { t, tn } = useI18n();
  // Sources wording only when sources were really in play; otherwise the old recordings-only text.
  const withSources = meta.askedSources && meta.searchedSources !== undefined;
  const sources = meta.searchedSources ?? 0;
  const none = sources === 0 && meta.searched === 0;
  return (
    <div className="space-y-2">
      {meta.citations.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("ask.sources")}>
          {meta.citations.map(citation => {
            const isSource = Boolean(citation.sourceId);
            const where = isSource ? formatLocation(citation.location, t) : formatTimestamp(citation.start);
            const phrase = isSource
              ? t("ask.cite.openSource", { title: citation.title, place: where || t("ask.cite.wholeSource") })
              : t("ask.cite.openRecording", { title: citation.title, place: where || t("ask.cite.wholeRecording") });
            return (
              <li key={citation.n} className="min-w-0 max-w-full">
                <Link
                  href={citationLink(citation)}
                  title={citation.snippet}
                  aria-label={phrase}
                  className="group flex min-h-8 max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-xs transition-colors hover:border-primary/50 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">{citation.n}</span>
                  {isSource && <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="truncate font-medium text-foreground">{citation.title}</span>
                  {where && <span className="shrink-0 tabular-nums text-muted-foreground">{where}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {none
          ? withSources
            ? t("ask.noMatchSources")
            : t("ask.noMatch")
          : withSources
            ? t("ask.searchedBoth", { sources: tn("ask.nSources", sources), recordings: tn("ask.nRecordings", meta.searched) })
            : tn(meta.retrieval === "hybrid" ? "ask.searchedHybrid" : "ask.searchedKeywords", meta.searched)}
      </p>
      {withSources && sources === 0 && meta.askedRecordings && meta.searched > 0 && <p className="text-xs text-muted-foreground">{t("ask.noSourceMatch")}</p>}
    </div>
  );
}
