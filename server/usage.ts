import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { subscriptions, usageEvents } from "../drizzle/schema";
import { betterPlan, getPlan, type Plan } from "@shared/plans";
import { teamPlanFor } from "./organizations";
import { referralRewardsThisMonth } from "./referrals";
import { withReferralBonus } from "@shared/referrals";
import { effectivePlanId } from "./billingState";
import { getDb } from "./db";
import { isMissingTableError } from "./bookmarks";
import { tolerateMissingSchema } from "./schemaTolerance";
import { isBillingConfigured } from "./stripe";
import { checkGenerationAllowance, checkTranscriptionAllowance, summarizeUsage, usagePeriod, UsageLimitError, type UsageTotals } from "./usageRules";
import { protectedProcedure } from "./_core/trpc";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { assertEmailConfirmed } from "./emailConfirmation";

/**
 * Monthly usage (F2): a ledger of transcription seconds and AI generations
 * per person per UTC month, and the checks that stop new work once a plan's
 * allowance is used up.
 *
 * Limits are enforced only when billing is configured (or the owner sets
 * USAGE_LIMITS_ENFORCED=true, e.g. to open sign-up before taking payments).
 * Without either, usage is still counted and shown, but nobody is blocked,
 * so turning this code on cannot start limiting existing users by surprise.
 * Admins are never limited.
 */

export function limitsEnforced(env: NodeJS.ProcessEnv = process.env) {
  return isBillingConfigured(env) || env.USAGE_LIMITS_ENFORCED?.trim() === "true";
}

type Person = { id: number; role?: string | null; loginMethod?: string | null; emailVerified?: number | null };

export async function getSubscriptionRow(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await tolerateMissingSchema(
    "billing",
    () => db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    [] as Array<typeof subscriptions.$inferSelect>,
  );
  return rows[0] ?? null;
}

export async function getPlanForUser(userId: number): Promise<Plan> {
  const own = getPlan(effectivePlanId(await getSubscriptionRow(userId)));
  // A member of a team with a live Team plan gets its allowance when it is larger.
  const team = await teamPlanFor(userId).catch(() => null);
  // Referral rewards (Phase 7) add to whichever plan applies, for the month they were earned.
  return withReferralBonus(team ? betterPlan(own, team) : own, await referralRewardsThisMonth(userId));
}

export async function getUsageTotals(userId: number, period = usagePeriod()): Promise<UsageTotals> {
  const db = await getDb();
  if (!db) return { transcriptionSeconds: 0, aiGenerations: 0 };
  const rows = await tolerateMissingSchema(
    "usage",
    () =>
      db
        .select({ kind: usageEvents.kind, total: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)` })
        .from(usageEvents)
        .where(and(eq(usageEvents.userId, userId), eq(usageEvents.period, period)))
        .groupBy(usageEvents.kind),
    [] as Array<{ kind: "transcription" | "ai_generation"; total: string }>,
  );
  const total = (kind: string) => Number(rows.find((row) => row.kind === kind)?.total ?? 0);
  return { transcriptionSeconds: total("transcription"), aiGenerations: total("ai_generation") };
}

export async function getUsageSummary(user: Person) {
  const [plan, totals] = await Promise.all([getPlanForUser(user.id), getUsageTotals(user.id)]);
  return { plan, period: usagePeriod(), enforced: limitsEnforced() && user.role !== "admin", ...summarizeUsage(plan, totals) };
}

function limitError(message: string, kind: "transcription" | "ai_generation") {
  const upgradeAvailable = isBillingConfigured();
  return new TRPCError({ code: "FORBIDDEN", message, cause: new UsageLimitError(message, kind, upgradeAvailable) });
}

/** Throws a clear FORBIDDEN error when a new transcription of `seconds` (0 when unknown) would not fit this month. */
export async function assertCanTranscribe(user: Person, seconds: number) {
  assertEmailConfirmed(user);
  if (!limitsEnforced() || user.role === "admin") return;
  const [plan, totals] = await Promise.all([getPlanForUser(user.id), getUsageTotals(user.id)]);
  const check = checkTranscriptionAllowance(plan, totals, seconds, { upgradeAvailable: isBillingConfigured() });
  if (!check.ok) throw limitError(check.message, "transcription");
}

export async function assertCanGenerate(user: Person) {
  assertEmailConfirmed(user);
  if (!limitsEnforced() || user.role === "admin") return;
  const [plan, totals] = await Promise.all([getPlanForUser(user.id), getUsageTotals(user.id)]);
  const check = checkGenerationAllowance(plan, totals, { upgradeAvailable: isBillingConfigured() });
  if (!check.ok) throw limitError(check.message, "ai_generation");
}

function isDuplicateKey(error: unknown) {
  for (let current: any = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current.code === "ER_DUP_ENTRY" || current.errno === 1062) return true;
  }
  return false;
}

/**
 * Adds a usage row. With a `dedupeKey`, the same charge is recorded once
 * (a duplicate key is the expected outcome of a repeat, not an error). Never
 * throws: losing a usage row must not fail the work it describes.
 */
export async function recordUsage(entry: { userId: number; kind: "transcription" | "ai_generation"; units: number; recordingId?: number | null; dedupeKey?: string | null }, now = new Date()) {
  if (entry.units <= 0) return { recorded: false };
  try {
    const db = await getDb();
    if (!db) return { recorded: false };
    await db.insert(usageEvents).values({
      userId: entry.userId,
      period: usagePeriod(now),
      kind: entry.kind,
      units: Math.round(entry.units),
      recordingId: entry.recordingId ?? null,
      dedupeKey: entry.dedupeKey ?? null,
    });
    return { recorded: true };
  } catch (error) {
    if (isDuplicateKey(error)) return { recorded: false };
    if (!isMissingTableError(error)) console.error("[usage] could not record usage:", error instanceof Error ? error.message : error);
    return { recorded: false };
  }
}

/** A recording's transcription is charged once, when it first completes. */
export function recordTranscriptionUsage(userId: number, recordingId: number, seconds: number) {
  return recordUsage({ userId, kind: "transcription", units: seconds, recordingId, dedupeKey: `transcription:${recordingId}` });
}

export function recordAiGeneration(userId: number, dedupeKey?: string) {
  return recordUsage({ userId, kind: "ai_generation", units: 1, dedupeKey: dedupeKey ?? null });
}

/**
 * For procedures that make one model call per request: refuses when the
 * month's AI generations are used up and counts one after a success.
 * Failures are not counted.
 */
export const AI_BURST_LIMIT = { windowMs: 10 * 60 * 1000, max: 60 };

export const aiProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // A burst cap that holds whether or not plan limits are enforced, so one
  // account (or a leaked API key) cannot run up the model bill in minutes.
  if (ctx.user.role !== "admin" && !checkTrpcRateLimit(`ai-burst:${ctx.user.id}`, AI_BURST_LIMIT.windowMs, AI_BURST_LIMIT.max)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of AI requests in a few minutes. Wait a little and try again." });
  }
  await assertCanGenerate(ctx.user);
  const result = await next();
  if (result.ok) await recordAiGeneration(ctx.user.id);
  return result;
});

export async function deleteUsageForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("usage", () => db.delete(usageEvents).where(eq(usageEvents.userId, userId)), undefined);
}

export async function exportUsageForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return tolerateMissingSchema(
    "usage",
    async () =>
      (await db.select().from(usageEvents).where(eq(usageEvents.userId, userId))).map(({ dedupeKey, ...row }) => row),
    [] as Array<Omit<typeof usageEvents.$inferSelect, "dedupeKey">>,
  );
}
