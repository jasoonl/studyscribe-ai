import { useId, useState } from "react";
import { Timer } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatNumber, t, tn, useI18n } from "@/i18n";
import { usePracticeCapabilities } from "@/hooks/usePracticeCapabilities";
import { defaultMinutes, EXTRA_TIME_CHOICES, minutesWithExtra } from "@/lib/practiceClock";
import { practiceErrorKind, practicePath, startErrorKey, startInput } from "@/lib/practiceModel";
import { practiceApi } from "@/lib/practiceTypes";

export type PracticeTarget = { scope: "quiz" | "pack" | "course"; quizId?: number; packId?: number; courseId?: number };

function clampInt(value: string, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Choose timed or untimed, how many questions (courses) and how long, then start. */
export function PracticeSetupDialog({
  open,
  onOpenChange,
  target,
  title,
  questionTotal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PracticeTarget;
  title: string;
  /** The number of questions when it is known (a quiz or a pack). */
  questionTotal?: number;
}) {
  useI18n();
  const [, navigate] = useLocation();
  const ids = useId();
  const [mode, setMode] = useState<"timed" | "review">("timed");
  const [countText, setCountText] = useState("15");
  const [minutesText, setMinutesText] = useState<string | null>(null);
  const [extra, setExtra] = useState<string>("1");
  const [errorKey, setErrorKey] = useState<ReturnType<typeof startErrorKey> | null>(null);
  const start = practiceApi.practice.start.useMutation();

  const isCourse = target.scope === "course";
  const count = isCourse ? clampInt(countText, 5, 40, 15) : (questionTotal ?? 10);
  const baseMinutes = minutesText === null ? defaultMinutes(count) : clampInt(minutesText, 5, 180, defaultMinutes(count));
  const extraValue = Number(extra);
  const totalMinutes = minutesWithExtra(baseMinutes, extraValue);

  const submit = () => {
    setErrorKey(null);
    start.mutate(
      startInput(
        target.scope,
        target,
        { mode, minutes: baseMinutes, questionCount: isCourse ? count : undefined, extraTime: extraValue },
      ),
      {
        onSuccess: result => {
          if (result.resumed) toast(t("practice.setup.resumed"));
          onOpenChange(false);
          navigate(practicePath(result.sessionId));
        },
        onError: error => setErrorKey(startErrorKey(practiceErrorKind(error))),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={next => !start.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("practice.setup.title")}</DialogTitle>
          <DialogDescription className="break-words">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("practice.setup.mode")}</legend>
            <RadioGroup value={mode} onValueChange={value => setMode(value as "timed" | "review")} className="gap-2">
              {(["timed", "review"] as const).map(option => (
                <Label key={option} htmlFor={`${ids}-${option}`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3 text-sm font-normal">
                  <RadioGroupItem value={option} id={`${ids}-${option}`} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{t(option === "timed" ? "practice.setup.timed" : "practice.setup.untimed")}</span>
                    <span className="block text-muted-foreground">{t(option === "timed" ? "practice.setup.timedText" : "practice.setup.untimedText")}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>

          {isCourse && (
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-count`}>{t("practice.setup.questions")}</Label>
              <Input id={`${ids}-count`} inputMode="numeric" type="number" min={5} max={40} value={countText} onChange={event => setCountText(event.target.value)} className="min-h-11 max-w-[8rem]" />
              <p className="text-xs text-muted-foreground">{t("practice.setup.questionsHelp")}</p>
            </div>
          )}

          {mode === "timed" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-minutes`}>{t("practice.setup.minutes")}</Label>
                <Input
                  id={`${ids}-minutes`}
                  inputMode="numeric"
                  type="number"
                  min={5}
                  max={180}
                  value={minutesText ?? String(baseMinutes)}
                  onChange={event => setMinutesText(event.target.value)}
                  className="min-h-11 max-w-[8rem]"
                />
                <p className="text-xs text-muted-foreground">{t("practice.setup.minutesHelp")}</p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("practice.setup.extra")}</legend>
                <RadioGroup value={extra} onValueChange={setExtra} className="gap-2">
                  {EXTRA_TIME_CHOICES.map(choice => (
                    <Label key={choice} htmlFor={`${ids}-x${choice}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-normal">
                      <RadioGroupItem value={String(choice)} id={`${ids}-x${choice}`} />
                      {t(choice === 1 ? "practice.setup.extraNone" : choice === 1.25 ? "practice.setup.extra25" : "practice.setup.extra50")}
                    </Label>
                  ))}
                </RadioGroup>
                <p className="text-xs text-muted-foreground">{t("practice.setup.extraHelp")}</p>
              </fieldset>
              <p className="text-sm font-medium tabular-nums">{t("practice.setup.total", { minutes: tn("practice.minutes", totalMinutes) })}</p>
            </>
          )}

          {errorKey && <p className="text-sm text-destructive" role="alert">{t(errorKey)}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="min-h-11" disabled={start.isPending} onClick={() => onOpenChange(false)}>
            {t("practice.cancel")}
          </Button>
          <Button className="min-h-11" disabled={start.isPending} onClick={submit}>
            {start.isPending ? t("practice.setup.starting") : t(mode === "timed" ? "practice.setup.start" : "practice.setup.startUntimed", { count: formatNumber(count) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Timed practice exam" button. Renders nothing unless the server has practice sessions. */
export function PracticeStartButton({
  target,
  title,
  questionTotal,
  variant = "outline",
  size = "sm",
  compactLabel = false,
}: {
  target: PracticeTarget;
  title: string;
  questionTotal?: number;
  variant?: "outline" | "default";
  size?: "sm" | "default";
  /** Hide the words on small screens (the button keeps its accessible name). */
  compactLabel?: boolean;
}) {
  useI18n();
  const { available } = usePracticeCapabilities();
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      <Button variant={variant} size={size} className="min-h-11 gap-2" onClick={() => setOpen(true)}>
        <Timer className="size-4" aria-hidden="true" />
        <span className={compactLabel ? "sr-only sm:not-sr-only" : undefined}>{t("practice.start")}</span>
      </Button>
      {open && <PracticeSetupDialog open={open} onOpenChange={setOpen} target={target} title={title} questionTotal={questionTotal} />}
    </>
  );
}
