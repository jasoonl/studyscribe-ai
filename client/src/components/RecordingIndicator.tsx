import { useRecorder } from "@/contexts/RecorderContext";
import { formatClockTime } from "@/lib/recordingClock";
import { Mic, MicOff } from "lucide-react";
import { useLocation } from "wouter";

/**
 * Floating pill shown while a recording is running or waiting to be saved and
 * no page is showing the full recorder, so moving around the app never hides it.
 */
export default function RecordingIndicator() {
  const { status, elapsedSeconds, micReconnecting, returnPath, recorderOnScreen } = useRecorder();
  const [, navigate] = useLocation();

  if (status === "idle" || recorderOnScreen) return null;

  const label =
    status === "stopped"
      ? "Unsaved recording"
      : micReconnecting
        ? "Reconnecting mic"
        : status === "paused"
          ? "Paused"
          : "Recording";

  return (
    <button
      type="button"
      onClick={() => navigate(returnPath ?? "/record-or-upload")}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl"
      aria-label={`${label}. Open the recorder.`}
    >
      {micReconnecting ? (
        <MicOff className="h-4 w-4 text-destructive" />
      ) : status === "recording" ? (
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      ) : (
        <Mic className="h-4 w-4 text-muted-foreground" />
      )}
      <span>{label}</span>
      <span className="font-mono text-muted-foreground">{formatClockTime(elapsedSeconds)}</span>
    </button>
  );
}
