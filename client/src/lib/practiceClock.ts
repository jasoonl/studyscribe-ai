/**
 * Timing for the practice exam. The server owns the deadline; the browser only shows how long
 * is left. Remaining time is always `deadline - server time`, where the server's time comes
 * from a monotonic clock anchored when the server last told us, so a wrong or changed device
 * clock, a throttled background tab or a reload cannot change it. Nothing here counts ticks.
 */

/**
 * The offset to add to `performance.now()` to get the server's time. `performance.now()` is
 * monotonic, so changing the device clock mid-exam cannot move the countdown. The server's
 * time is taken to be `serverNowMs` plus half the round trip by the time it arrived. If the
 * server's time is not a finite number, the device clock at that moment stands in for it.
 */
export function clockOffset(serverNowMs: number, perfReceivedMs: number, rttMs = 0, deviceNowMs: number = Date.now()): number {
  if (!Number.isFinite(perfReceivedMs)) return 0;
  const half = Number.isFinite(rttMs) && rttMs > 0 ? rttMs / 2 : 0;
  const server = Number.isFinite(serverNowMs) ? serverNowMs + half : deviceNowMs;
  return server - perfReceivedMs;
}

/** The server's time now, from `performance.now()` and an offset. */
export function serverNow(offsetMs: number, perfNowMs: number): number {
  return perfNowMs + offsetMs;
}

/**
 * Whole seconds left, rounded up so "0:01" shows until the last moment, never negative; null
 * when the deadline or the time is not a finite number (unknown, not zero).
 */
export function remainingSeconds(deadlineMs: number, serverNowMs: number): number | null {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(serverNowMs)) return null;
  return Math.max(0, Math.ceil((deadlineMs - serverNowMs) / 1000));
}

/** "mm:ss", or "h:mm:ss" from an hour up. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type Threshold = { id: string; seconds: number };

/**
 * Where a screen reader hears about the time: half way, 10 minutes, 5 minutes, 1 minute,
 * 30 seconds and the end. Only points inside the exam count (a 5 minute exam has no
 * "10 minutes left"), and points at the same second collapse to the later name.
 */
export function thresholdsFor(totalSeconds: number): Threshold[] {
  if (!(totalSeconds > 0)) return [];
  const candidates: Threshold[] = [
    { id: "half", seconds: Math.floor(totalSeconds / 2) },
    { id: "600", seconds: 600 },
    { id: "300", seconds: 300 },
    { id: "60", seconds: 60 },
    { id: "30", seconds: 30 },
    { id: "0", seconds: 0 },
  ];
  const bySeconds = new Map<number, Threshold>();
  for (const candidate of candidates) {
    if (candidate.id !== "half" && candidate.id !== "0" && candidate.seconds >= totalSeconds) continue;
    if (candidate.id === "half" && candidate.seconds <= 0) continue;
    bySeconds.set(candidate.seconds, candidate);
  }
  // A fixed point that lands on the half way mark keeps the clearer fixed wording.
  for (const candidate of candidates) if (bySeconds.has(candidate.seconds) && candidate.id !== "half") bySeconds.set(candidate.seconds, candidate);
  return Array.from(bySeconds.values()).sort((a, b) => b.seconds - a.seconds);
}

/**
 * Which thresholds have been reached and not yet handled. `announce` is the most urgent one
 * (say only that), `mark` is everything reached so a skipped one, such as after a reload or a
 * sleeping tab, is never read out late.
 */
export function reachedThresholds(
  totalSeconds: number,
  remaining: number,
  handled: readonly string[],
): { announce: Threshold | null; mark: string[] } {
  const reached = thresholdsFor(totalSeconds).filter(threshold => remaining <= threshold.seconds && !handled.includes(threshold.id));
  return { announce: reached.length > 0 ? reached[reached.length - 1] : null, mark: reached.map(threshold => threshold.id) };
}

/** On first load of a running exam, thresholds already behind it are quietly marked as handled. */
export function alreadyPassed(totalSeconds: number, remaining: number): string[] {
  return thresholdsFor(totalSeconds)
    .filter(threshold => remaining < threshold.seconds)
    .map(threshold => threshold.id);
}

export type AnnouncementSpec = { kind: "half" | "over" | "seconds" | "minutes"; count: number };

/** What a threshold says out loud, as data the screen turns into words. */
export function announcementSpec(id: string): AnnouncementSpec {
  if (id === "half") return { kind: "half", count: 0 };
  if (id === "0") return { kind: "over", count: 0 };
  const seconds = Number(id);
  if (seconds < 60) return { kind: "seconds", count: seconds };
  return { kind: "minutes", count: Math.max(1, Math.round(seconds / 60)) };
}

/** True in the last minute, when the clock gets words as well as a colour. */
export function isLowTime(remaining: number): boolean {
  return remaining <= 60;
}

/** Seconds used out of the limit, clamped. */
export function secondsUsed(limitSeconds: number, remaining: number): number {
  return Math.min(Math.max(0, limitSeconds), Math.max(0, limitSeconds - remaining));
}

/** How long to wait before the next try to send answers: 2s, 4s, 8s, 15s, then 30s. */
export function retryDelayMs(attempt: number): number {
  const steps = [2000, 4000, 8000, 15000, 30000];
  return steps[Math.min(Math.max(0, attempt), steps.length - 1)];
}

/** Default length for an exam of n questions, as the server picks it. */
export function defaultMinutes(questionCount: number): number {
  return Math.min(180, Math.max(5, Math.ceil(questionCount * 1.5)));
}

export const EXTRA_TIME_CHOICES = [1, 1.25, 1.5] as const;
export type ExtraTime = (typeof EXTRA_TIME_CHOICES)[number];

/** Minutes after the extra-time setting, rounded up and capped. */
export function minutesWithExtra(minutes: number, extra: number): number {
  return Math.min(180, Math.ceil(minutes * extra));
}
