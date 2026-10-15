import type { LiveStatus } from "@/lib/liveTranscription";
import { cn } from "@/lib/utils";
import { t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

const LABELS: Record<LiveStatus | "unsupported", MessageKey> = {
  idle: "live.status.off",
  connecting: "live.status.connecting",
  live: "live.status.listening",
  reconnecting: "live.status.reconnecting",
  paused: "live.status.paused",
  error: "live.status.stopped",
  unavailable: "live.status.unavailable",
  unsupported: "live.status.unavailable",
};

/** A small dot and word for the live transcription state. */
export function LiveStatusLabel({ status, className }: { status: LiveStatus | "unsupported"; className?: string }) {
  useI18n();
  const tone =
    status === "live"
      ? "bg-primary"
      : status === "connecting" || status === "reconnecting"
        ? "bg-course-amber"
        : status === "error" || status === "unavailable" || status === "unsupported"
          ? "bg-destructive"
          : "bg-muted-foreground/60";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", tone, status === "live" && "motion-safe:animate-pulse")} />
      {t(LABELS[status])}
    </span>
  );
}
