import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { useRecorder } from "@/contexts/RecorderContext";
import type { LiveTurn } from "@/lib/liveTurns";

// Its own small file so the recording pill (in every page) can use it without loading the live transcript UI.
/** What the record pages show of live text right now. */
export function useLiveLayout(snapshot: LiveTurn[] | null) {
  const { enabled, turns, status } = useLiveTranscript();
  const { status: recorderStatus } = useRecorder();
  const recording = recorderStatus === "recording" || recorderStatus === "paused";
  const showTranscript = snapshot !== null ? snapshot.length > 0 : (enabled && recording) || (recorderStatus === "stopped" && turns.length > 0);
  const showHelp = snapshot === null && enabled && recording && status !== "unavailable" && status !== "unsupported";
  return { showTranscript, showHelp, wide: showTranscript || showHelp };
}
