import { describe, expect, it } from "vitest";
import { getPlan, PLANS } from "@shared/plans";
import { checkGenerationAllowance, checkTranscriptionAllowance, formatResetDate, nextResetDate, secondsToBilledMinutes, summarizeUsage, usagePeriod } from "./usageRules";
import { limitsEnforced } from "./usage";
import { canEnableOpenSignup, createEmailVerificationToken, decideSignupPath, openSignupDailyCap, readEmailVerificationToken } from "./openSignup";
import { needsEmailConfirmation } from "./emailConfirmation";

const free = getPlan("free");
const now = new Date("2026-10-13T12:00:00Z");

describe("usage periods", () => {
  it("is the UTC calendar month and resets on the 1st", () => {
    expect(usagePeriod(now)).toBe("2026-10");
    expect(usagePeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(nextResetDate(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(formatResetDate(now)).toBe("November 1");
  });

  it("bills started minutes", () => {
    expect(secondsToBilledMinutes(0)).toBe(0);
    expect(secondsToBilledMinutes(1)).toBe(1);
    expect(secondsToBilledMinutes(60)).toBe(1);
    expect(secondsToBilledMinutes(61)).toBe(2);
  });
});

describe("allowances", () => {
  it("every plan has positive allowances that grow with the price", () => {
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].priceMonthlyUsd).toBeGreaterThan(PLANS[i - 1].priceMonthlyUsd);
      expect(PLANS[i].transcriptionMinutesPerMonth).toBeGreaterThan(PLANS[i - 1].transcriptionMinutesPerMonth);
      expect(PLANS[i].aiGenerationsPerMonth).toBeGreaterThan(PLANS[i - 1].aiGenerationsPerMonth);
    }
    // Free is enough to try a full lecture and every study tool on it.
    expect(free.transcriptionMinutesPerMonth).toBeGreaterThanOrEqual(90);
    expect(free.aiGenerationsPerMonth).toBeGreaterThanOrEqual(20);
  });

  it("summarises what is used and left", () => {
    expect(summarizeUsage(free, { transcriptionSeconds: 30 * 60 + 1, aiGenerations: 5 })).toMatchObject({ minutesUsed: 31, minutesLeft: free.transcriptionMinutesPerMonth - 31, generationsLeft: free.aiGenerationsPerMonth - 5 });
  });

  it("lets a recording start when it fits, and refuses one that does not", () => {
    const used = { transcriptionSeconds: (free.transcriptionMinutesPerMonth - 10) * 60, aiGenerations: 0 };
    expect(checkTranscriptionAllowance(free, used, 9 * 60, { now })).toEqual({ ok: true });
    const tooLong = checkTranscriptionAllowance(free, used, 45 * 60, { now });
    expect(tooLong.ok).toBe(false);
    expect(!tooLong.ok && tooLong.message).toMatch(/about 45 minutes long and you have 10 minutes of transcription left/);
  });

  it("lets a recording of unknown length start while any minutes remain", () => {
    expect(checkTranscriptionAllowance(free, { transcriptionSeconds: (free.transcriptionMinutesPerMonth - 1) * 60, aiGenerations: 0 }, 0, { now }).ok).toBe(true);
    const out = checkTranscriptionAllowance(free, { transcriptionSeconds: free.transcriptionMinutesPerMonth * 60, aiGenerations: 0 }, 0, { now });
    expect(!out.ok && out.message).toMatch(/used all 2 hours of transcription on the Free plan this month\. It resets on November 1\.$/);
  });

  it("mentions paid plans only when they can be bought", () => {
    const used = { transcriptionSeconds: 0, aiGenerations: free.aiGenerationsPerMonth };
    const withoutBilling = checkGenerationAllowance(free, used, { now });
    const withBilling = checkGenerationAllowance(free, used, { now, upgradeAvailable: true });
    expect(!withoutBilling.ok && withoutBilling.message).not.toMatch(/Billing/);
    expect(!withBilling.ok && withBilling.message).toMatch(/Billing has plans with more/);
    expect(checkGenerationAllowance(free, { transcriptionSeconds: 0, aiGenerations: free.aiGenerationsPerMonth - 1 }, { now })).toEqual({ ok: true });
  });

  it("is enforced only when billing is configured or explicitly switched on", () => {
    expect(limitsEnforced({} as NodeJS.ProcessEnv)).toBe(false);
    expect(limitsEnforced({ USAGE_LIMITS_ENFORCED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(
      limitsEnforced({ STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh", STRIPE_PRICE_BASIC: "a", STRIPE_PRICE_PRO: "b", STRIPE_PRICE_MAX: "c" } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
    // Half-configured Stripe must not start limiting anyone.
    expect(limitsEnforced({ STRIPE_SECRET_KEY: "sk" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("open sign-up", () => {
  const base = { openSignup: true, recentSignups: 0, dailyCap: 200 };

  it("an invite always works, open or not", () => {
    expect(decideSignupPath({ ...base, inviteCode: "abc", openSignup: false })).toEqual({ path: "invite" });
    expect(decideSignupPath({ ...base, inviteCode: "abc" })).toEqual({ path: "invite" });
  });

  it("without an invite, only while open and under the daily cap", () => {
    expect(decideSignupPath({ ...base, inviteCode: null })).toEqual({ path: "open" });
    expect(decideSignupPath({ ...base, inviteCode: "  ", openSignup: false })).toMatchObject({ path: "closed" });
    expect(decideSignupPath({ ...base, inviteCode: null, recentSignups: 200 })).toMatchObject({ path: "closed", reason: expect.stringMatching(/paused for today/) });
  });

  it("can be switched on only while limits are enforced", () => {
    expect(canEnableOpenSignup(true)).toEqual({ ok: true });
    expect(canEnableOpenSignup(false)).toMatchObject({ ok: false, reason: expect.stringMatching(/USAGE_LIMITS_ENFORCED/) });
  });

  it("reads the daily cap from the environment with a safe default", () => {
    expect(openSignupDailyCap({} as NodeJS.ProcessEnv)).toBe(200);
    expect(openSignupDailyCap({ OPEN_SIGNUP_DAILY_CAP: "25" } as unknown as NodeJS.ProcessEnv)).toBe(25);
    expect(openSignupDailyCap({ OPEN_SIGNUP_DAILY_CAP: "nonsense" } as unknown as NodeJS.ProcessEnv)).toBe(200);
  });

  it("asks only open sign-ups to confirm their email, and only when email can be sent", () => {
    expect(needsEmailConfirmation({ loginMethod: "email_open", emailVerified: 0 }, true)).toBe(true);
    expect(needsEmailConfirmation({ loginMethod: "email_open", emailVerified: 1 }, true)).toBe(false);
    expect(needsEmailConfirmation({ loginMethod: "email_open", emailVerified: 0 }, false)).toBe(false);
    // Accounts that existed before open sign-up are never caught by it.
    expect(needsEmailConfirmation({ loginMethod: "email", emailVerified: 0 }, true)).toBe(false);
    expect(needsEmailConfirmation({ loginMethod: null, emailVerified: 0 }, true)).toBe(false);
  });

  it("confirmation links carry the user and email and nothing else verifies", () => {
    const token = createEmailVerificationToken(42, "Student@Example.com");
    expect(readEmailVerificationToken(token)).toEqual({ uid: 42, email: "student@example.com" });
    expect(readEmailVerificationToken(token + "x")).toBeNull();
    expect(readEmailVerificationToken("not-a-token")).toBeNull();
  });
});
