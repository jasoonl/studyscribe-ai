import { useState } from "react";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { useRecorder } from "@/contexts/RecorderContext";
import type { LiveTurn } from "@/lib/liveTurns";
import { LiveCaptions } from "./LiveCaptions";
import { LiveTranscriptPanel } from "./LiveTranscriptPanel";

/** What the record pages show of live text right now. */
export function useLiveLayout(snapshot: LiveTurn[] | null) {
  const { enabled, turns, status } = useLiveTranscript();
  const { status: recorderStatus } = useRecorder();
  const recording = recorderStatus === "recording" || recorderStatus === "paused";
  const showTranscript = snapshot !== null ? snapshot.length > 0 : (enabled && recording) || (recorderStatus === "stopped" && turns.length > 0);
  const showHelp = snapshot === null && enabled && recording && status !== "unavailable" && status !== "unsupported";
  return { showTranscript, showHelp, wide: showTranscript || showHelp };
}

/**
 * The live transcript plus its full-screen captions view. With `snapshot`,
 * shows text kept after upload until the real transcript is ready.
 */
export function LiveTranscriptSection({ snapshot }: { snapshot: LiveTurn[] | null }) {
  const live = useLiveTranscript();
  const { status: recorderStatus } = useRecorder();
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const recording = recorderStatus === "recording" || recorderStatus === "paused";
  const turns = snapshot ?? live.turns;

  const footnote = snapshot
    ? "A quick preview from live transcription. It is replaced by the full transcript, with speakers, as soon as that is ready."
    : recording
      ? "A quick preview. The full transcript, with speakers, is made after you save."
      : "A quick preview. Save the recording to get the full transcript, with speakers.";

  return (
    <>
      <LiveTranscriptPanel
        turns={turns}
        status={snapshot ? null : recording ? live.status : null}
        message={snapshot || !recording ? null : live.message}
        onOpenCaptions={() => setCaptionsOpen(true)}
        footnote={footnote}
      />
      <LiveCaptions open={captionsOpen} onOpenChange={setCaptionsOpen} turns={turns} status={snapshot ? null : recording ? live.status : null} />
    </>
  );
}
