import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { useRecorder } from "@/contexts/RecorderContext";
import { liveWindowText } from "@/lib/liveTurns";
import { formatClockTime } from "@/lib/recordingClock";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { t, useI18n } from "@/i18n";
import {
  LIVE_ASSIST_ACTION_INFO,
  MAX_LIVE_ASSIST_QUESTION_CHARS,
  MAX_LIVE_ASSIST_WINDOW_CHARS,
  MIN_LIVE_ASSIST_WINDOW_CHARS,
  type LiveAssistAction,
} from "@shared/liveAssist";

const QUICK_ACTIONS: LiveAssistAction[] = ["explain", "recap", "examFocus", "questions"];

const ACTION_LABELS = {
  explain: "live.help.action.explain",
  recap: "live.help.action.recap",
  examFocus: "live.help.action.examFocus",
  questions: "live.help.action.questions",
  custom: "live.help.action.custom",
} as const satisfies Record<LiveAssistAction, string>;

const ACTION_PENDING = {
  explain: "live.help.pending.explain",
  recap: "live.help.pending.recap",
  examFocus: "live.help.pending.examFocus",
  questions: "live.help.pending.questions",
  custom: "live.help.pending.custom",
} as const satisfies Record<LiveAssistAction, string>;

/**
 * "Study help" beside the live transcript (A2): quick, visible help about the
 * last few minutes, for understanding and taking part. It works only from
 * live text the person can see on the same page.
 */
export function StudyHelpPanel({ audience, className }: { audience: "student" | "professional"; className?: string }) {
  useI18n();
  const { turns, assists, addAssist } = useLiveTranscript();
  const { getElapsedSeconds } = useRecorder();
  const [question, setQuestion] = useState("");
  const [pendingAction, setPendingAction] = useState<LiveAssistAction | null>(null);
  const liveAssist = trpc.ai.liveAssist.useMutation();

  const enoughText = liveWindowText(turns, 300, MAX_LIVE_ASSIST_WINDOW_CHARS).length >= MIN_LIVE_ASSIST_WINDOW_CHARS;
  const meeting = audience === "professional";
  const label = (action: LiveAssistAction) =>
    meeting && action === "examFocus" ? t("live.help.meeting.examFocus") : meeting && action === "questions" ? t("live.help.meeting.questions") : t(ACTION_LABELS[action]);

  const ask = async (action: LiveAssistAction, text?: string) => {
    if (pendingAction) return;
    const windowSeconds = LIVE_ASSIST_ACTION_INFO[action].windowSeconds;
    const transcriptWindow = liveWindowText(turns, windowSeconds, MAX_LIVE_ASSIST_WINDOW_CHARS);
    const atSeconds = Math.floor(getElapsedSeconds());
    setPendingAction(action);
    try {
      const result = await liveAssist.mutateAsync({
        action,
        transcriptWindow,
        windowSeconds,
        audience,
        ...(text ? { question: text } : {}),
      });
      addAssist({ id: `${Date.now()}-${action}`, action, question: text ?? null, answer: result.answer, atSeconds });
      if (action === "custom") setQuestion("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("live.help.error"));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section aria-labelledby="study-help-heading" className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm", className)}>
      <header className="border-b border-border px-5 py-3">
        <h2 id="study-help-heading" className="text-base font-semibold">{t("live.help.title")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("live.help.subtitle")}</p>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map(action => (
            <Button
              key={action}
              type="button"
              variant="outline"
              className="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left text-sm leading-snug"
              disabled={!enoughText || pendingAction !== null}
              onClick={() => void ask(action)}
            >
              {pendingAction === action && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
              {label(action)}
            </Button>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault();
            const text = question.trim();
            if (text) void ask("custom", text);
          }}
        >
          <label htmlFor="study-help-question" className="sr-only">{meeting ? t("live.help.askMeeting") : t("live.help.askLecture")}</label>
          <Input
            id="study-help-question"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder={meeting ? t("live.help.askMeeting") : t("live.help.askLecture")}
            maxLength={MAX_LIVE_ASSIST_QUESTION_CHARS}
            disabled={!enoughText}
          />
          <Button type="submit" disabled={!enoughText || !question.trim() || pendingAction !== null} className="gap-1.5">
            {pendingAction === "custom" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("live.help.ask")}
          </Button>
        </form>

        {!enoughText && (
          <p className="text-sm text-muted-foreground">{t("live.help.notEnough")}</p>
        )}
      </div>

      {(assists.length > 0 || pendingAction) && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border" aria-live="polite" aria-busy={pendingAction !== null}>
          {pendingAction && (
            <p className="flex items-center gap-2 px-5 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t(ACTION_PENDING[pendingAction])}
            </p>
          )}
          <ol className="divide-y divide-border">
            {assists.map(entry => (
              <li key={entry.id} className="px-5 py-4">
                <p className="flex items-baseline justify-between gap-3 text-xs font-medium text-muted-foreground">
                  <span>{entry.question ? t("live.help.quoted", { question: entry.question }) : label(entry.action)}</span>
                  <span className="shrink-0 font-mono tabular-nums">{t("live.help.at", { time: formatClockTime(entry.atSeconds) })}</span>
                </p>
                <div className="prose-sm mt-2 text-sm leading-relaxed [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5">
                  <Markdown>{entry.answer}</Markdown>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
