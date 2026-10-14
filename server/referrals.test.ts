import { describe, expect, it } from "vitest";
import { getPlan } from "../shared/plans";
import { MAX_REFERRAL_REWARDS_PER_MONTH, normaliseReferralCode, REFERRAL_REWARD, withReferralBonus } from "../shared/referrals";

describe("referral codes", () => {
  it("accepts codes typed in any case and refuses lookalike or wrong-length ones", () => {
    expect(normaliseReferralCode(" abcd2345 ")).toBe("ABCD2345");
    expect(normaliseReferralCode("ABCD234O")).toBeNull(); // letter O is not used
    expect(normaliseReferralCode("ABC")).toBeNull();
    expect(normaliseReferralCode(42)).toBeNull();
  });
});

describe("withReferralBonus", () => {
  const free = getPlan("free");
  it("adds each reward to the plan's allowances and keeps the plan itself", () => {
    const boosted = withReferralBonus(free, 2);
    expect(boosted.id).toBe("free");
    expect(boosted.transcriptionMinutesPerMonth).toBe(free.transcriptionMinutesPerMonth + 2 * REFERRAL_REWARD.transcriptionMinutes);
    expect(boosted.aiGenerationsPerMonth).toBe(free.aiGenerationsPerMonth + 2 * REFERRAL_REWARD.aiGenerations);
  });
  it("returns the plan unchanged with no rewards and caps an impossible count", () => {
    expect(withReferralBonus(free, 0)).toBe(free);
    const capped = withReferralBonus(free, 999);
    expect(capped.transcriptionMinutesPerMonth).toBe(free.transcriptionMinutesPerMonth + (MAX_REFERRAL_REWARDS_PER_MONTH + 1) * REFERRAL_REWARD.transcriptionMinutes);
  });
});
