import { useState } from "react";
import { LiveTranscriptSection } from "@/components/live/LiveTranscriptSection";
import { StudyHelpPanel } from "@/components/live/StudyHelpPanel";
import { cn } from "@/lib/utils";
import { t, useI18n } from "@/i18n";

/** What the recording pill's Study help sheet shows: a Lecture/Meeting choice, the live transcript and Study help. */
export default function StudyHelpSheetBody() {
  useI18n();
  const [audience, setAudience] = useState<"student" | "professional">("student");
  return (
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
  );
}
