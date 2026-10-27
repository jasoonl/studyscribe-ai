import { useState } from "react";
import { Link } from "wouter";
import { FileText, FolderInput, Presentation, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/formatBytes";
import { failureReasonOf, isRetryableReason, kindLabelKey, stageOf, summaryPercent, type SourceSummary } from "@/lib/sourceModel";
import { isStalled } from "@/lib/sourceUpload";
import { useI18n } from "@/i18n";
import { MAX_SOURCES_PER_COURSE } from "@shared/const";
import { CourseDot } from "@/components/CourseDot";
import { DeleteSourceDialog } from "./DeleteSourceDialog";
import { MoveSourceDialog } from "./MoveSourceDialog";
import { SourceProgress } from "./SourceProgress";
import { SourceStatusBadge } from "./SourceStatusBadge";

type Props = {
  source: SourceSummary;
  /** True while this tab is already driving the source, so Continue is not offered. */
  driven: boolean;
  onContinue: (source: SourceSummary) => void;
  onRetry: (source: SourceSummary) => void;
  onDelete: (source: SourceSummary) => void;
  deleting?: boolean;
  now: number;
  /** The course the file is filed under, shown as a label (Files page). */
  course?: { name: string; color: unknown } | null;
  /** Offers "Move" to file it under a course or take it out of one (Files page). */
  movable?: boolean;
};

export function unitNounKey(kind: SourceSummary["kind"]) {
  return kind === "pptx" ? ("sources.meta.slides" as const) : kind === "pdf" ? ("sources.meta.pages" as const) : ("sources.meta.sections" as const);
}

export function SourceCard({ source, driven, onContinue, onRetry, onDelete, deleting, now, course, movable }: Props) {
  const { t, tn, formatDate, formatNumber } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const stage = stageOf(source.status);
  const reason = failureReasonOf(source.errorMessage, source.kind);
  const working = stage === "waiting" || stage === "reading" || stage === "summarizing";
  const stalled = !driven && isStalled(source, now);
  const percent = summaryPercent(source);
  const Icon = source.kind === "pptx" ? Presentation : FileText;

  const meta = [
    t(kindLabelKey(source.kind)),
    source.unitCount > 0 ? tn(unitNounKey(source.kind), source.unitCount) : null,
    formatBytes(source.sizeBytes, formatNumber),
    formatDate(source.createdAt, { month: "short", day: "numeric", year: "numeric" }),
  ].filter(Boolean);

  const stageText = stage === "summarizing" && source.partCount > 0 ? t("sources.upload.summarizingParts", { done: formatNumber(source.partsDone), total: formatNumber(source.partCount) }) : t(`sources.status.${stage}`);

  return (
    <li className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-mist text-primary" aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <h3 className="min-w-0 break-words text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
              <Link href={`/sources/${source.id}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                {source.title}
              </Link>
            </h3>
            <SourceStatusBadge status={source.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{meta.join(" · ")}</p>
          {course !== undefined && (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              {course ? (
                <>
                  <CourseDot color={course.color} className="size-2" />
                  <span className="min-w-0 truncate">{course.name}</span>
                </>
              ) : (
                <span>{t("files.unfiled")}</span>
              )}
            </p>
          )}

          {working && (
            <div className="mt-3">
              <SourceProgress percent={stage === "summarizing" ? percent : null} label={t("sources.upload.progressNamed", { name: source.title })} valueText={stageText} />
              <p className="mt-1.5 text-xs text-muted-foreground">{stalled ? t("sources.card.stalled") : stageText}</p>
            </div>
          )}

          {stage === "failed" && (
            <p role="alert" className="mt-2.5 text-sm text-destructive">
              {t(`sources.reason.${reason}`, { max: MAX_SOURCES_PER_COURSE })}
            </p>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {stage === "ready" && (
              <>
                <Link href={`/sources/${source.id}`}>
                  <Button size="sm" variant="outline" className="min-h-9">
                    {t("sources.card.open")}
                  </Button>
                </Link>
                <Link href={`/ask?${source.courseId ? `course=${source.courseId}&` : ""}source=${source.id}`}>
                  <Button size="sm" variant="outline" className="min-h-9 gap-1.5">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {t("sources.card.ask")}
                  </Button>
                </Link>
              </>
            )}
            {working && stalled && (
              <Button size="sm" variant="outline" className="min-h-9 gap-1.5" onClick={() => onContinue(source)}>
                <RotateCw className="size-3.5" aria-hidden="true" />
                {t("sources.card.continue")}
              </Button>
            )}
            {stage === "failed" && isRetryableReason(reason) && (
              <Button size="sm" variant="outline" className="min-h-9 gap-1.5" onClick={() => onRetry(source)}>
                <RotateCw className="size-3.5" aria-hidden="true" />
                {t("sources.upload.retry")}
              </Button>
            )}
            {movable && (
              <Button size="sm" variant="ghost" className="ml-auto min-h-9 gap-1.5 text-muted-foreground" onClick={() => setMoving(true)} aria-label={t("files.move.named", { name: source.title })}>
                <FolderInput className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t("files.move.button")}</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className={movable ? "min-h-9 gap-1.5 text-muted-foreground" : "ml-auto min-h-9 gap-1.5 text-muted-foreground"}
              onClick={() => setConfirming(true)}
              aria-label={t("sources.delete.named", { name: source.title })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("sources.delete.button")}</span>
            </Button>
          </div>
        </div>
      </div>
      {movable && <MoveSourceDialog source={source} open={moving} onOpenChange={setMoving} />}
      <DeleteSourceDialog title={source.title} open={confirming} onOpenChange={setConfirming} pending={deleting} onConfirm={() => onDelete(source)} />
    </li>
  );
}
