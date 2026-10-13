import { formatMinutes, type Plan } from "@shared/plans";

/**
 * Pure usage arithmetic (F2): which month a charge belongs to, how much is
 * left, and the message shown when an allowance runs out. The database side
 * lives in server/usage.ts.
 */

/** Usage resets on the 1st of each month, UTC, for everyone. */
export function usagePeriod(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function nextResetDate(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function formatResetDate(date = new Date()) {
  return nextResetDate(date).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** Seconds are billed as whole minutes, rounded up, so a 30-second clip counts as one minute. */
export function secondsToBilledMinutes(seconds: number) {
  return seconds > 0 ? Math.ceil(seconds / 60) : 0;
}

export type UsageTotals = { transcriptionSeconds: number; aiGenerations: number };

export function summarizeUsage(plan: Plan, totals: UsageTotals) {
  const minutesUsed = secondsToBilledMinutes(totals.transcriptionSeconds);
  return {
    minutesUsed,
    minutesLimit: plan.transcriptionMinutesPerMonth,
    minutesLeft: Math.max(0, plan.transcriptionMinutesPerMonth - minutesUsed),
    generationsUsed: totals.aiGenerations,
    generationsLimit: plan.aiGenerationsPerMonth,
    generationsLeft: Math.max(0, plan.aiGenerationsPerMonth - totals.aiGenerations),
  };
}

export type AllowanceCheck = { ok: true } | { ok: false; message: string };

type CheckOptions = { now?: Date; upgradeAvailable?: boolean };
const upgradeHint = (plan: Plan, upgradeAvailable = false) => (plan.id === "max" || !upgradeAvailable ? "" : " Billing has plans with more.");

/**
 * Whether a new transcription may start. A recording whose length is known
 * must fit in what is left; one of unknown length (0) may start while any
 * minutes remain. Once started, a transcription always finishes, even if it
 * goes over, so nobody loses a lecture halfway.
 */
export function checkTranscriptionAllowance(plan: Plan, totals: UsageTotals, newSeconds: number, { now = new Date(), upgradeAvailable }: CheckOptions = {}): AllowanceCheck {
  const { minutesLeft } = summarizeUsage(plan, totals);
  const needed = secondsToBilledMinutes(newSeconds);
  const reset = formatResetDate(now);
  if (minutesLeft <= 0) {
    return { ok: false, message: `You have used all ${formatMinutes(plan.transcriptionMinutesPerMonth)} of transcription on the ${plan.name} plan this month. It resets on ${reset}.${upgradeHint(plan, upgradeAvailable)}` };
  }
  if (needed > minutesLeft) {
    return { ok: false, message: `This recording is about ${needed} minutes long and you have ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} of transcription left this month on the ${plan.name} plan. It resets on ${reset}.${upgradeHint(plan, upgradeAvailable)}` };
  }
  return { ok: true };
}

export function checkGenerationAllowance(plan: Plan, totals: UsageTotals, { now = new Date(), upgradeAvailable }: CheckOptions = {}): AllowanceCheck {
  if (totals.aiGenerations >= plan.aiGenerationsPerMonth) {
    return { ok: false, message: `You have used all ${plan.aiGenerationsPerMonth} AI generations on the ${plan.name} plan this month. They reset on ${formatResetDate(now)}.${upgradeHint(plan, upgradeAvailable)}` };
  }
  return { ok: true };
}

/**
 * Thrown (as the cause of a FORBIDDEN tRPC error) when an allowance is used
 * up. The tRPC error formatter turns it into `data.usageLimit`, which the
 * client uses to offer a link to Billing next to the message.
 */
export class UsageLimitError extends Error {
  constructor(message: string, readonly kind: "transcription" | "ai_generation", readonly upgradeAvailable: boolean) {
    super(message);
    this.name = "UsageLimitError";
  }
}
