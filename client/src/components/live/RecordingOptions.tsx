import { Presentation, MonitorSpeaker } from "lucide-react";
import { MAX_SLIDES_PER_RECORDING } from "@shared/slides";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { useRecorder } from "@/contexts/RecorderContext";
import { trpc } from "@/lib/trpc";
import { t, tn, useI18n } from "@/i18n";

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
  useI18n();
  const { enabled, setEnabled } = useLiveTranscript();
  const availability = useLiveAvailability();
  const unavailable = availability !== null && !availability.available;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor="live-text-switch" className="text-sm font-medium">{t("live.transcript.title")}</label>
        <p id="live-text-help" className="mt-0.5 text-sm text-muted-foreground">
          {unavailable
            ? t("live.toggle.unavailable")
            : t("live.toggle.help")}
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

/** "Capture slides" (A6): keep a picture of the shared tab or screen whenever it changes. */
function CaptureSlidesOption({ idSuffix }: { idSuffix: string }) {
  useI18n();
  const { captureSlides, setCaptureSlides } = useRecorder();
  const id = `capture-slides-${idSuffix}`;
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={captureSlides} onCheckedChange={value => setCaptureSlides(value === true)} className="mt-0.5" aria-describedby={`${id}-help`} />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{t("record.slides.label")}</label>
        <p id={`${id}-help`} className="mt-0.5 text-sm text-muted-foreground">
          {t("record.slides.help", { max: MAX_SLIDES_PER_RECORDING })}
        </p>
      </div>
    </div>
  );
}

/**
 * "Record a tab or screen audio" (A3). Before recording: a checkbox, used by
 * the page when it calls `start`, and under it "Capture slides" (A6). While
 * recording: add or stop the share. Hidden where the browser can't capture
 * tab audio.
 */
export function TabAudioOption({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const { tabAudioSupported } = useRecorder();
  useI18n();
  if (!tabAudioSupported) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Checkbox id="tab-audio-option" checked={checked} onCheckedChange={value => onCheckedChange(value === true)} className="mt-0.5" aria-describedby="tab-audio-help" />
        <div className="min-w-0">
          <label htmlFor="tab-audio-option" className="text-sm font-medium">{t("record.tabAudio.label")}</label>
          <p id="tab-audio-help" className="mt-0.5 text-sm text-muted-foreground">
            {t("record.tabAudio.help")}
          </p>
        </div>
      </div>
      {checked && (
        <div className="pl-7">
          <CaptureSlidesOption idSuffix="start" />
        </div>
      )}
    </div>
  );
}

export function TabAudioControl() {
  const { tabAudioSupported, tabAudioActive, slidesActive, slideCount, addTabAudio, stopTabAudio, status } = useRecorder();
  useI18n();
  const live = status === "recording" || status === "paused";
  if (!tabAudioSupported || !live) return null;
  const sharing = tabAudioActive || slidesActive;
  const slideLabel = tn("record.slides.kept", slideCount);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
        {sharing ? (
          <>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              {slidesActive ? <Presentation className="h-4 w-4 text-primary" aria-hidden="true" /> : <MonitorSpeaker className="h-4 w-4 text-primary" aria-hidden="true" />}
              {tabAudioActive && slidesActive
                ? t("record.tabAudio.recordingAndSlides")
                : slidesActive
                  ? t("record.tabAudio.slidesOnly")
                  : t("record.tabAudio.audioOnly")}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={stopTabAudio}>
              {t("record.tabAudio.stopSharing")}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void addTabAudio()}>
            <MonitorSpeaker className="h-4 w-4" aria-hidden="true" />
            {t("record.tabAudio.add")}
          </Button>
        )}
      </div>
      {(slidesActive || slideCount > 0) && (
        <p className="text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">{slideLabel}</p>
      )}
      {!sharing && (
        <div className="mx-auto max-w-md">
          <CaptureSlidesOption idSuffix="live" />
        </div>
      )}
    </div>
  );
}
