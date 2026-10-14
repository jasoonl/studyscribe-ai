import type { Plan } from "./plans";

// Referrals (Phase 7). When someone who signed up through a person's link finishes their
// first transcription, both get this much extra for that month. PROPOSED amounts: the owner
// confirms them like the plan allowances.
export const REFERRAL_REWARD = { transcriptionMinutes: 60, aiGenerations: 50 } as const;
/** Rewards a referrer can earn in one month; joining through a link earns one. */
export const MAX_REFERRAL_REWARDS_PER_MONTH = 10;
/** How long after creating an account a referral can still be claimed. */
export const REFERRAL_CLAIM_DAYS = 7;
/** How long a referral code remembered by the browser stays valid. */
export const REFERRAL_REMEMBER_DAYS = 30;

// No 0/O, 1/I/L: codes are read aloud and typed by hand.
export const REFERRAL_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_LENGTH = 8;

export function normaliseReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of code) if (!REFERRAL_ALPHABET.includes(ch)) return null;
  return code;
}

/** A plan with this month's referral rewards added to its allowances. */
export function withReferralBonus(plan: Plan, rewards: number): Plan {
  const n = Math.max(0, Math.min(MAX_REFERRAL_REWARDS_PER_MONTH + 1, Math.floor(rewards)));
  if (n === 0) return plan;
  return {
    ...plan,
    transcriptionMinutesPerMonth: plan.transcriptionMinutesPerMonth + n * REFERRAL_REWARD.transcriptionMinutes,
    aiGenerationsPerMonth: plan.aiGenerationsPerMonth + n * REFERRAL_REWARD.aiGenerations,
  };
}
