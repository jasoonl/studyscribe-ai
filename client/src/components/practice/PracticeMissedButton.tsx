import { useEffect, useId, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { usePracticeWork } from "@/contexts/PracticeWorkContext";
import { t, useI18n } from "@/i18n";
import { canRetry, originKey, practiceErrorKey, practicePath } from "@/lib/practiceModel";
import type { PracticeOrigin } from "@/lib/practiceTypes";

/**
 * "Practice what I missed": a set of the missed questions, with a few new questions like them
 * if the person wants. The work runs above the router (`PracticeWorkProvider`), so leaving
 * this page does not stop it.
 */
export function PracticeMissedButton({ origin, allowSimilar }: { origin: PracticeOrigin; allowSimilar: boolean }) {
  useI18n();
  const { job, busy: anyBusy, start, attach, dismiss } = usePracticeWork();
  const [, navigate] = useLocation();
  const [similar, setSimilar] = useState(true);
  const checkId = useId();
  const key = originKey(origin);
  const mine = job && job.key === key ? job : null;
  const busy = mine?.step === "preparing" || mine?.step === "adding";
  const otherBusy = anyBusy && !busy;

  useEffect(() => attach(key), [attach, key]);

  // Open the finished set once; the key stops a re-render from opening it again.
  const opened = useRef("");
  useEffect(() => {
    if (!mine || mine.step !== "done" || mine.sessionId === null) return;
    const token = `${key}:${mine.sessionId}`;
    if (opened.current === token) return;
    opened.current = token;
    if (mine.similarFailed) toast(t("mistakes.similarFailed"));
    navigate(practicePath(mine.sessionId));
    dismiss();
  }, [mine?.step, mine?.sessionId, mine?.similarFailed, key, navigate, dismiss]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button className="min-h-11 gap-2 self-start" disabled={anyBusy} onClick={() => start(origin, { similar: allowSimilar && similar })}>
          {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
          {t("mistakes.practice")}
        </Button>
        {allowSimilar && (
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox id={checkId} checked={similar} disabled={busy} onCheckedChange={value => setSimilar(value === true)} />
            <Label htmlFor={checkId} className="text-sm font-normal">{t("mistakes.practiceSimilar")}</Label>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {mine?.step === "preparing" ? t("mistakes.step.preparing") : mine?.step === "adding" ? t("mistakes.step.adding") : otherBusy ? t("mistakes.otherBusy") : ""}
      </p>
      {mine?.step === "failed" && mine.error && (
        <p className="text-sm text-destructive" role="alert">
          {t(practiceErrorKey(mine.error.kind))}
          {canRetry(mine.error.kind) ? ` ${t("mistakes.tryAgainHint")}` : ""}
        </p>
      )}
    </div>
  );
}
