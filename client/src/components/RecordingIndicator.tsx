import { useRecorder } from "@/contexts/RecorderContext";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { formatClockTime } from "@/lib/recordingClock";
import { Mic, MicOff } from "lucide-react";
import { useLocation } from "wouter";

/**
 * Floating pill shown while a recording is running or waiting to be saved and
 * no page is showing the full recorder, so moving around the app never hides it.
 * With live text on, it also shows the last thing said (Phase 7), so you can keep
 * following along from another page.
 */
export default function RecordingIndicator() {
  const { status, elapsedSeconds, micReconnecting, returnPath, recorderOnScreen } = useRecorder();
  const [, navigate] = useLocation();
  const live = useLiveTranscript();

  if (status === "idle" || recorderOnScreen) return null;

  const label =
    status === "stopped"
      ? "Unsaved recording"
      : micReconnecting
        ? "Reconnecting mic"
        : status === "paused"
          ? "Paused"
          : "Recording";
  const lastLine = live.enabled && status === "recording" ? lastWords(live.turns.at(-1)?.text ?? "") : "";

  return (
    <button
      type="button"
      onClick={() => navigate(returnPath ?? "/record-or-upload")}
      className={`fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-1 border border-border bg-card px-4 py-2 text-left text-sm font-medium text-card-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl sm:max-w-sm ${lastLine ? "rounded-2xl" : "rounded-full"}`}
      aria-label={`${label}. Open the recorder.`}
    >
      <span className="flex items-center gap-2">
      {micReconnecting ? (
        <MicOff className="h-4 w-4 text-destructive" />
      ) : status === "recording" ? (
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      ) : (
        <Mic className="h-4 w-4 text-muted-foreground" />
      )}
      <span>{label}</span>
      <span className="font-mono text-muted-foreground">{formatClockTime(elapsedSeconds)}</span>
      </span>
      {lastLine && (
        // Not announced: it changes several times a second. The recorder page has the full live transcript.
        <span aria-hidden="true" className="line-clamp-2 text-xs font-normal leading-snug text-muted-foreground">
          {lastLine}
        </span>
      )}
    </button>
  );
}

/** The end of the latest line, so the newest words are the ones that show. */
function lastWords(text: string, max = 110) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(-max);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}
