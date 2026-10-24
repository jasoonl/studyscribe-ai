import { AlertCircle, CheckCircle2, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceProgress } from "./SourceProgress";
import type { UploadRow, UploadRowError } from "@/hooks/useSourceUploads";
import { isRetryableReason } from "@/lib/sourceModel";
import { formatBytes } from "@/lib/formatBytes";
import { useI18n } from "@/i18n";
import { MAX_SOURCES_PER_COURSE, MAX_SOURCE_LABEL, MAX_SOURCE_TEXT_LABEL } from "@shared/const";

export function useUploadErrorText() {
  const { t } = useI18n();
  return (error: UploadRowError): string => {
    switch (error.kind) {
      case "file":
        return error.code === "tooLarge"
          ? t("sources.error.tooLarge", { size: MAX_SOURCE_LABEL, textSize: MAX_SOURCE_TEXT_LABEL })
          : t(`sources.error.${error.code}`);
      case "reason":
        return t(`sources.reason.${error.code}`, { max: MAX_SOURCES_PER_COURSE });
      case "usageLimit":
        return t("sources.error.usageLimit");
      case "rateLimited":
        return t("sources.error.rateLimited");
      case "stillReading":
        return t("sources.error.stillReading");
      case "notSetUp":
        return t("sources.error.notSetUp");
      default:
        return error.text;
    }
  };
}

/** One file going through upload, reading and summarizing, with its own progress, cancel and retry. */
export function SourceUploadRow({ row, onRetry, onRemove }: { row: UploadRow; onRetry: (id: string) => void; onRemove: (id: string) => void }) {
  const { t, formatNumber } = useI18n();
  const errorText = useUploadErrorText();
  const working = row.stage !== "done" && row.stage !== "error";

  const stageText =
    row.stage === "waiting"
      ? t("sources.upload.waiting")
      : row.stage === "uploading"
        ? t("sources.upload.uploading", { percent: formatNumber(row.progress) })
        : row.stage === "saving"
          ? t("sources.upload.saving")
          : row.stage === "reading"
            ? t("sources.status.reading")
            : row.stage === "summarizing"
              ? row.partsTotal > 0
                ? t("sources.upload.summarizingParts", { done: formatNumber(row.partsDone), total: formatNumber(row.partsTotal) })
                : t("sources.status.summarizing")
              : row.stage === "finishing"
                ? t("sources.upload.finishing")
                : row.stage === "done"
                  ? t("sources.status.ready")
                  : t("sources.upload.failed");

  const percent =
    row.stage === "uploading"
      ? row.progress
      : row.stage === "summarizing" && row.partsTotal > 0
        ? Math.round((row.partsDone / row.partsTotal) * 100)
        : null;

  return (
    <li className="rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {row.stage === "done" ? (
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
            ) : row.stage === "error" ? (
              <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
            <span>{stageText}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatBytes(row.size, formatNumber)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {row.stage === "error" && row.canRetry && !(row.error?.kind === "reason" && !isRetryableReason(row.error.code)) && (
            <Button type="button" variant="outline" size="sm" className="min-h-9 gap-1.5" onClick={() => onRetry(row.id)}>
              <RotateCw className="size-3.5" aria-hidden="true" />
              {t("sources.upload.retry")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => onRemove(row.id)}
            aria-label={working ? t("sources.upload.cancelNamed", { name: row.name }) : t("sources.upload.removeNamed", { name: row.name })}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {working && row.stage !== "waiting" && (
        <SourceProgress className="mt-3" percent={percent} label={t("sources.upload.progressNamed", { name: row.name })} valueText={stageText} />
      )}

      {row.error && (
        <p role="alert" className="mt-2.5 text-sm text-destructive">
          {errorText(row.error)}
        </p>
      )}
    </li>
  );
}
