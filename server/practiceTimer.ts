import { PRACTICE_GRACE_SECONDS } from "@shared/const";

/**
 * Timer rules for timed practice (pure). The server clock decides: the
 * deadline is fixed when the session starts, a submission is on time up to the
 * grace period after it, and a session nobody submitted is finalised from its
 * saved answers once that period has passed.
 */

export const EXTRA_TIME_FACTORS = [1, 1.25, 1.5] as const;
export type ExtraTime = (typeof EXTRA_TIME_FACTORS)[number];

export const MIN_MINUTES = 5;
export const MAX_MINUTES = 180;

/** Default length: a minute and a half per question, rounded up to whole minutes, within the allowed range. */
export function defaultMinutes(questionCount: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil((questionCount * 1.5))));
}

/** Seconds allowed once the extra-time setting is applied. */
export function timeLimitSeconds(minutes: number, extra: number = 1): number {
  const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
  const factor = (EXTRA_TIME_FACTORS as readonly number[]).includes(extra) ? extra : 1;
  return Math.round(clamped * 60 * factor);
}

export function deadlineFor(startedAt: Date, limitSeconds: number): Date {
  return new Date(startedAt.getTime() + limitSeconds * 1000);
}

export type TimerState = "running" | "grace" | "expired";

/** running: before the deadline; grace: a submission is still on time; expired: only saved answers count. */
export function timerState(now: Date, deadlineAt: Date | null, graceSeconds = PRACTICE_GRACE_SECONDS): TimerState {
  if (!deadlineAt) return "running";
  const t = now.getTime();
  const deadline = deadlineAt.getTime();
  if (t <= deadline) return "running";
  if (t <= deadline + graceSeconds * 1000) return "grace";
  return "expired";
}

/** Whether an unsubmitted session should be finalised from its saved answers now. */
export function shouldAutoSubmit(now: Date, session: { submittedAt: Date | null; deadlineAt: Date | null }, graceSeconds = PRACTICE_GRACE_SECONDS): boolean {
  return !session.submittedAt && timerState(now, session.deadlineAt, graceSeconds) === "expired";
}

/** Whether new answers may still be saved or submitted as made in time. */
export function acceptsAnswers(now: Date, deadlineAt: Date | null, graceSeconds = PRACTICE_GRACE_SECONDS): boolean {
  return timerState(now, deadlineAt, graceSeconds) !== "expired";
}

/**
 * Seconds used, never more than the time allowed: a late or automatic
 * submission is counted as the whole limit, not the time since the tab closed.
 */
export function secondsUsed(startedAt: Date, endedAt: Date, limitSeconds: number | null): number {
  const elapsed = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  return limitSeconds ? Math.min(elapsed, limitSeconds) : elapsed;
}
