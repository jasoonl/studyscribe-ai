import { useState } from "react";
import { useRecorder } from "@/contexts/RecorderContext";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { LiveTranscriptSection, useLiveLayout } from "@/components/live/LiveTranscriptSection";
import { StudyHelpPanel } from "@/components/live/StudyHelpPanel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatClockTime } from "@/lib/recordingClock";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { t, useI18n } from "@/i18n";

/**
 * Floating pill shown while a recording is running or waiting to be saved and
 * no page is showing the full recorder, so moving around the app never hides it.
 * With live text on, it also shows the last thing said (Phase 7), so you can keep
 * following along from another page, and opens Study help in a side sheet next to
 * the live transcript, so help never relies on text the person can't see.
 */
export default function RecordingIndicator() {
  const { status, elapsedSeconds, micReconnecting, returnPath, recorderOnScreen } = useRecorder();
  const [, navigate] = useLocation();
  const live = useLiveTranscript();
  const { showHelp } = useLiveLayout(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [audience, setAudience] = useState<"student" | "professional">("student");
  useI18n();

  if (status === "idle" || recorderOnScreen) return null;

  const label =
    status === "stopped"
      ? t("record.indicator.unsaved")
      : micReconnecting
        ? t("record.indicator.reconnectingMic")
        : status === "paused"
          ? t("record.status.paused")
          : t("record.indicator.recording");
  const lastLine = live.enabled && status === "recording" ? lastWords(live.turns.at(-1)?.text ?? "") : "";

  return (
    <>
      <div
        className={cn(
          "fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-1 border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-lg sm:max-w-sm",
          lastLine || showHelp ? "rounded-2xl" : "rounded-full",
        )}
      >
        <button
          type="button"
          onClick={() => navigate(returnPath ?? "/record-or-upload")}
          className="flex flex-col gap-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("record.indicator.openAria", { status: label })}
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
            // Not announced: it changes several times a second. The sheet and the recorder page have the full live transcript.
            <span aria-hidden="true" className="line-clamp-2 text-xs font-normal leading-snug text-muted-foreground">
              {lastLine}
            </span>
          )}
        </button>
        {showHelp && (
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label={t("live.help.openAria")}
            className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full border border-border px-3 py-1 text-xs font-medium text-primary transition-colors hover:border-primary/40 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {t("live.help.open")}
          </button>
        )}
      </div>

      <Sheet open={helpOpen && showHelp} onOpenChange={setHelpOpen}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="shrink-0 pr-10">
            <SheetTitle>{t("live.help.title")}</SheetTitle>
            <SheetDescription>{t("live.help.sheetText")}</SheetDescription>
          </SheetHeader>
          <div className="shrink-0 space-y-4 px-4 pb-6">
            <fieldset className="flex flex-wrap items-center gap-2 text-sm">
              <legend className="sr-only">{t("live.help.kind")}</legend>
              <span aria-hidden="true" className="text-muted-foreground">{t("live.help.kind")}</span>
              {(["student", "professional"] as const).map(kind => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={audience === kind}
                  onClick={() => setAudience(kind)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    audience === kind ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary",
                  )}
                >
                  {t(kind === "student" ? "live.help.kindLecture" : "live.help.kindMeeting")}
                </button>
              ))}
            </fieldset>
            <LiveTranscriptSection snapshot={null} />
            <StudyHelpPanel audience={audience} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The end of the latest line, so the newest words are the ones that show. */
function lastWords(text: string, max = 110) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(-max);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}
