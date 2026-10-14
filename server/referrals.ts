import { randomInt } from "node:crypto";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { referralCodes, referrals, users } from "../drizzle/schema";
import {
  MAX_REFERRAL_REWARDS_PER_MONTH,
  REFERRAL_ALPHABET,
  REFERRAL_CLAIM_DAYS,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REWARD,
  normaliseReferralCode,
} from "../shared/referrals";
import { isMissingTableError } from "./bookmarks";
import { getDb } from "./db";
import { usagePeriod } from "./usageRules";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Referrals (Phase 7). referralCodes and referrals arrive with migration 0032, applied by
 * hand; until then codes read as unavailable, claims are skipped and nobody gets a bonus.
 */

async function tolerate<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(`[referrals] ${label}: table missing; run \`npm run db:migrate\` (migration 0032)`);
      return fallback;
    }
    throw error;
  }
}

function newCode() {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) code += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return code;
}

/** The person's code, made the first time it is asked for. Null before migration 0032. */
export async function getOrCreateReferralCode(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  return tolerate(
    "code",
    async () => {
      const [existing] = await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
      if (existing) return existing.code;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const code = newCode();
          await db.insert(referralCodes).values({ userId, code });
          return code;
        } catch (error) {
          // A clash with another code (retry) or a parallel request that already made this person's.
          const [made] = await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
          if (made) return made.code;
          if (attempt === 4) throw error;
        }
      }
      return null;
    },
    null,
  );
}

export type ClaimOutcome = "claimed" | "invalid" | "own" | "already" | "too_late" | "unavailable";

/**
 * Links a new account to the person whose link brought it here. Only within
 * REFERRAL_CLAIM_DAYS of the account being made, once, and never to oneself.
 */
export async function claimReferral(userId: number, rawCode: string): Promise<ClaimOutcome> {
  const code = normaliseReferralCode(rawCode);
  if (!code) return "invalid";
  const db = await getDb();
  if (!db) return "unavailable";
  return tolerate(
    "claim",
    async (): Promise<ClaimOutcome> => {
      const [owner] = await db.select({ userId: referralCodes.userId }).from(referralCodes).where(eq(referralCodes.code, code)).limit(1);
      if (!owner) return "invalid";
      if (owner.userId === userId) return "own";
      const [me] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (!me || Date.now() - me.createdAt.getTime() > REFERRAL_CLAIM_DAYS * 86_400_000) return "too_late";
      try {
        await db.insert(referrals).values({ referrerId: owner.userId, referredUserId: userId });
        return "claimed";
      } catch {
        return "already";
      }
    },
    "unavailable",
  );
}

/**
 * Called when a recording's transcription completes. The first one for an account that
 * joined through a link rewards both people for this month. Never throws.
 */
export async function rewardReferralForFirstTranscript(userId: number, now = new Date()) {
  const db = await getDb();
  if (!db) return;
  await tolerate(
    "reward",
    async () => {
      await db
        .update(referrals)
        .set({ rewardedAt: now, rewardPeriod: usagePeriod(now) })
        .where(and(eq(referrals.referredUserId, userId), isNull(referrals.rewardedAt)));
    },
    undefined,
  ).catch((error) => console.error("[referrals] could not record the reward:", error));
}

/** How many rewards the person has this month: up to MAX for people they brought, plus one for joining by link. */
export async function referralRewardsThisMonth(userId: number, period = usagePeriod()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return tolerate(
    "rewards",
    async () => {
      const [asReferrer] = await db
        .select({ n: count() })
        .from(referrals)
        .where(and(eq(referrals.referrerId, userId), eq(referrals.rewardPeriod, period)));
      const [asReferred] = await db
        .select({ n: count() })
        .from(referrals)
        .where(and(eq(referrals.referredUserId, userId), eq(referrals.rewardPeriod, period)));
      return Math.min(MAX_REFERRAL_REWARDS_PER_MONTH, Number(asReferrer?.n ?? 0)) + Math.min(1, Number(asReferred?.n ?? 0));
    },
    0,
  ).catch(() => 0);
}

export async function getReferralSummary(userId: number) {
  const code = await getOrCreateReferralCode(userId);
  const db = await getDb();
  const rows = db
    ? await tolerate(
        "summary",
        () => db.select({ rewardedAt: referrals.rewardedAt }).from(referrals).where(eq(referrals.referrerId, userId)),
        [] as Array<{ rewardedAt: Date | null }>,
      )
    : [];
  return {
    code,
    joined: rows.length,
    rewarded: rows.filter((r) => r.rewardedAt).length,
    rewardsThisMonth: await referralRewardsThisMonth(userId),
    reward: REFERRAL_REWARD,
    maxPerMonth: MAX_REFERRAL_REWARDS_PER_MONTH,
  };
}

// ─── Export and account deletion ───────────────────────────────────────────

export async function exportReferralsForUser(userId: number) {
  const db = await getDb();
  if (!db) return { referralCode: null, referrals: [] };
  return {
    referralCode: await tolerate("export code", async () => (await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.userId, userId)))[0]?.code ?? null, null),
    referrals: await tolerate(
      "export",
      () =>
        db
          .select({ createdAt: referrals.createdAt, rewardedAt: referrals.rewardedAt, rewardPeriod: referrals.rewardPeriod, referrerId: referrals.referrerId, referredUserId: referrals.referredUserId })
          .from(referrals)
          .where(or(eq(referrals.referrerId, userId), eq(referrals.referredUserId, userId))),
      [],
    ),
  };
}

export async function deleteReferralsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerate("delete codes", () => db.delete(referralCodes).where(eq(referralCodes.userId, userId)), undefined);
  // Rewards already given stay given for the other person; only this person's rows go.
  await tolerate("delete referrals", () => db.delete(referrals).where(or(eq(referrals.referrerId, userId), eq(referrals.referredUserId, userId))), undefined);
}

export const referralsRouter = router({
  mine: protectedProcedure.query(({ ctx }) => getReferralSummary(ctx.user.id)),
  claim: protectedProcedure
    .input(z.object({ code: z.string().max(32) }))
    .mutation(async ({ ctx, input }) => ({ outcome: await claimReferral(ctx.user.id, input.code) })),
});
