import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { stageOf, type SourceStage, type SourceStatus } from "@/lib/sourceModel";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const TONE: Record<SourceStage, string> = {
  waiting: "bg-secondary text-secondary-foreground",
  reading: "bg-brand-mist text-primary",
  summarizing: "bg-brand-mist text-primary",
  ready: "bg-secondary text-foreground",
  failed: "bg-destructive/10 text-destructive",
};

/** The stage in words, with an icon as well, so state never depends on colour. */
export function SourceStatusBadge({ status, className }: { status: SourceStatus; className?: string }) {
  const { t } = useI18n();
  const stage = stageOf(status);
  const Icon = stage === "ready" ? CheckCircle2 : stage === "failed" ? AlertCircle : stage === "waiting" ? Clock : Loader2;
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", TONE[stage], className)}>
      <Icon className={cn("size-3.5 shrink-0", (stage === "reading" || stage === "summarizing") && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      {t(`sources.status.${stage}`)}
    </span>
  );
}
