import { useRef, useState } from "react";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { useRecorder } from "@/contexts/RecorderContext";
import type { LiveTurn } from "@/lib/liveTurns";
import { LiveCaptions } from "./LiveCaptions";
import { LiveTranscriptPanel } from "./LiveTranscriptPanel";
import { t, useI18n } from "@/i18n";

export { useLiveLayout } from "./liveLayout";

/**
 * The live transcript plus its full-screen captions view. With `snapshot`,
 * shows text kept after upload until the real transcript is ready.
 */
export function LiveTranscriptSection({ snapshot }: { snapshot: LiveTurn[] | null }) {
  useI18n();
  const live = useLiveTranscript();
  const { status: recorderStatus } = useRecorder();
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const recording = recorderStatus === "recording" || recorderStatus === "paused";
  const turns = snapshot ?? live.turns;

  const footnote = snapshot
    ? t("live.footnote.snapshot")
    : recording
      ? t("live.footnote.recording")
      : t("live.footnote.stopped");

  return (
    <>
      <LiveTranscriptPanel
        turns={turns}
        status={snapshot ? null : recording ? live.status : null}
        message={snapshot || !recording ? null : live.message}
        onOpenCaptions={opener => {
          openerRef.current = opener;
          setCaptionsOpen(true);
        }}
        footnote={footnote}
      />
      <LiveCaptions open={captionsOpen} onOpenChange={setCaptionsOpen} turns={turns} status={snapshot ? null : recording ? live.status : null} returnFocusTo={() => openerRef.current} />
    </>
  );
}
