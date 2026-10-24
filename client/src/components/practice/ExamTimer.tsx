import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, t, tn, useI18n } from "@/i18n";
import { alreadyPassed, announcementSpec, formatClock, isLowTime, reachedThresholds, remainingSeconds, serverNow } from "@/lib/practiceClock";
import { readTimerHidden, writeTimerHidden } from "@/lib/practiceModel";

function announcementFor(id: string): string {
  const spec = announcementSpec(id);
  switch (spec.kind) {
    case "half":
      return t("practice.announce.half");
    case "over":
      return t("practice.announce.over");
    case "seconds":
      return tn("practice.announce.seconds", spec.count);
    default:
      return tn("practice.announce.minutes", spec.count);
  }
}

/**
 * The countdown. Time left is always the server's deadline minus the server's time, taken from
 * a monotonic clock anchored when the server last answered (`offsetMs`), so a reload, a
 * sleeping tab or a changed device clock cannot move it. The visible clock is
 * silent to screen readers (`aria-live="off"`); a separate polite region speaks only at half
 * time, 10, 5 and 1 minute, 30 seconds and the end. Nothing pulses or animates.
 */
export function ExamTimer({
  deadlineMs,
  offsetMs,
  totalSeconds,
  onExpire,
}: {
  deadlineMs: number;
  offsetMs: number;
  totalSeconds: number;
  onExpire: () => void;
}) {
  useI18n();
  const [perf, setPerf] = useState(() => performance.now());
  const [hidden, setHidden] = useState(readTimerHidden);
  const [spoken, setSpoken] = useState("");
  const [over, setOver] = useState(false);
  const handled = useRef<string[] | null>(null);
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const tick = () => setPerf(performance.now());
    const timer = window.setInterval(tick, 1000);
    // Background tabs slow timers down; recompute the moment the tab is seen again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // Unknown (a broken time from the server) is not zero: nothing expires and the clock shows dashes.
  const known = remainingSeconds(deadlineMs, serverNow(offsetMs, perf));
  const remaining = known ?? Number.POSITIVE_INFINITY;

  useEffect(() => {
    if (handled.current === null) handled.current = alreadyPassed(totalSeconds, remaining);
    const { announce, mark } = reachedThresholds(totalSeconds, remaining, handled.current);
    if (mark.length > 0) handled.current = [...handled.current, ...mark];
    if (announce) {
      if (announce.id === "0") setOver(true);
      else setSpoken(announcementFor(announce.id));
    }
    if (known !== null && remaining <= 0 && !expired.current) {
      expired.current = true;
      onExpireRef.current();
    }
  }, [remaining, known, totalSeconds]);

  const low = known !== null && isLowTime(known);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    writeTimerHidden(next);
  };

  return (
    <div className="flex items-center gap-3">
      <div role="timer" aria-live="off" aria-label={t("practice.timer.label")} className="min-w-[4.5rem]">
        {hidden ? (
          <span className="text-sm text-muted-foreground">{t("practice.timer.hidden")}</span>
        ) : (
          <span className={`text-xl font-semibold tabular-nums ${low ? "text-destructive" : "text-foreground"}`}>{known === null ? "--:--" : formatClock(known)}</span>
        )}
      </div>
      {!hidden && low && remaining > 0 && <span className="text-sm font-medium text-destructive">{t("practice.timer.low")}</span>}
      <Button variant="ghost" size="sm" className="min-h-11 gap-2" onClick={toggle}>
        {hidden ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
        <span className="sr-only sm:not-sr-only">{hidden ? t("practice.timer.show") : t("practice.timer.hide")}</span>
      </Button>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {spoken}
      </div>
      <div className="sr-only" role="alert">
        {over ? t("practice.announce.over") : ""}
      </div>
    </div>
  );
}
