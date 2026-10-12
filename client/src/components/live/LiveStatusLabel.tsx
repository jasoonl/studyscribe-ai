import type { LiveStatus } from "@/lib/liveTranscription";
import { cn } from "@/lib/utils";

const LABELS: Record<LiveStatus | "unsupported", string> = {
  idle: "Off",
  connecting: "Connecting",
  live: "Listening",
  reconnecting: "Reconnecting",
  paused: "Paused",
  error: "Stopped",
  unavailable: "Unavailable",
  unsupported: "Unavailable",
};

/** A small dot and word for the live transcription state. */
export function LiveStatusLabel({ status, className }: { status: LiveStatus | "unsupported"; className?: string }) {
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
      {LABELS[status]}
    </span>
  );
}
