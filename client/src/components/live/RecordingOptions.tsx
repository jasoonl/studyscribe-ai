import { MonitorSpeaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { useRecorder } from "@/contexts/RecorderContext";
import { trpc } from "@/lib/trpc";

/** Whether this server can run live text at all (an API key and not switched off). */
export function useLiveAvailability() {
  const { data } = trpc.recordings.liveAvailability.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  return data ?? null;
}

/**
 * Opt-in for live text. Off by default: while it is on, the audio is streamed
 * to the transcription provider for as long as the recording runs.
 */
export function LiveTextToggle() {
  const { enabled, setEnabled } = useLiveTranscript();
  const availability = useLiveAvailability();
  const unavailable = availability !== null && !availability.available;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor="live-text-switch" className="text-sm font-medium">Live transcript</label>
        <p id="live-text-help" className="mt-0.5 text-sm text-muted-foreground">
          {unavailable
            ? "Not available on this server yet. Your recording is still transcribed after you save."
            : "Words appear as they're spoken, with study help and captions. Your audio is sent to our transcription provider while you record."}
        </p>
      </div>
      <Switch
        id="live-text-switch"
        checked={enabled && !unavailable}
        disabled={unavailable}
        onCheckedChange={setEnabled}
        aria-describedby="live-text-help"
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * "Record a tab or screen audio" (A3). Before recording: a checkbox, used by
 * the page when it calls `start`. While recording: add or stop the share.
 * Hidden where the browser can't capture tab audio.
 */
export function TabAudioOption({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const { tabAudioSupported } = useRecorder();
  if (!tabAudioSupported) return null;
  return (
    <div className="flex items-start gap-3">
      <Checkbox id="tab-audio-option" checked={checked} onCheckedChange={value => onCheckedChange(value === true)} className="mt-0.5" aria-describedby="tab-audio-help" />
      <div className="min-w-0">
        <label htmlFor="tab-audio-option" className="text-sm font-medium">Record a tab or screen audio too</label>
        <p id="tab-audio-help" className="mt-0.5 text-sm text-muted-foreground">
          For an online class or video. Choose the tab and turn on "Also share tab audio". Your microphone is recorded as well.
        </p>
      </div>
    </div>
  );
}

export function TabAudioControl() {
  const { tabAudioSupported, tabAudioActive, addTabAudio, stopTabAudio, status } = useRecorder();
  const live = status === "recording" || status === "paused";
  if (!tabAudioSupported || !live) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
      {tabAudioActive ? (
        <>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <MonitorSpeaker className="h-4 w-4 text-primary" aria-hidden="true" />
            Recording tab audio and your microphone
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={stopTabAudio}>
            Stop tab audio
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void addTabAudio()}>
          <MonitorSpeaker className="h-4 w-4" aria-hidden="true" />
          Add tab or screen audio
        </Button>
      )}
    </div>
  );
}
