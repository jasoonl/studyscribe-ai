import express, { type Express, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { stripeEvents, subscriptions, users } from "../drizzle/schema";
import { getPlan, isPaidPlanId, PAID_PLAN_IDS, withAvailability } from "@shared/plans";
import { describeStatus, ENTITLED_STATUSES, effectivePlanId, nextSubscriptionState, stateAfterPaymentFailed, type StoredSubscription } from "./billingState";
import { notifyUser } from "./collabNotifications";
import { getDb } from "./db";
import { getSafeApplicationOrigin } from "./email";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { describeBillingConfig, getStripeConfig, isBillingConfigured, StripeApiError, stripeRequest, verifyStripeSignature, type StripeConfig } from "./stripe";
import { getSubscriptionRow, getUsageSummary, limitsEnforced } from "./usage";
import { formatResetDate } from "./usageRules";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

/**
 * Paid plans (F2): Stripe Checkout to subscribe, Stripe's customer portal to
 * change plan, update the card or cancel, and a signed webhook that keeps the
 * `subscriptions` table in step with Stripe. Card details only ever go to
 * Stripe's hosted pages.
 */

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

function requireConfig(): StripeConfig {
  const config = getStripeConfig();
  if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paid plans are not on sale yet." });
  return config;
}

function stripeFailure(error: unknown, what: string): never {
  console.error(`[billing] ${what} failed:`, error instanceof Error ? error.message : error);
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({ code: "BAD_GATEWAY", message: `Could not ${what} right now. Nothing was charged. Try again in a moment.` });
}

function toStored(row: typeof subscriptions.$inferSelect | null): StoredSubscription | null {
  if (!row) return null;
  return {
    planId: row.planId,
    status: row.status,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripePriceId: row.stripePriceId,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    lastEventAt: row.lastEventAt,
  };
}

/** The person's Stripe customer, created on first checkout. */
async function ensureCustomer(user: { id: number; email: string; name: string | null }, config: StripeConfig) {
  const existing = await getSubscriptionRow(user.id);
  if (existing) return existing.stripeCustomerId;
  const db = await requireDb();
  const customer = await stripeRequest<{ id: string }>(
    "POST",
    "/customers",
    { email: user.email, name: user.name ?? undefined, metadata: { userId: String(user.id) } },
    { idempotencyKey: `studyscribe-customer-${user.id}`, config },
  );
  await explainMissingSchema("Billing", () =>
    db.insert(subscriptions).values({ userId: user.id, stripeCustomerId: customer.id }).onDuplicateKeyUpdate({ set: { stripeCustomerId: sql`stripeCustomerId` } }),
  );
  return (await getSubscriptionRow(user.id))?.stripeCustomerId ?? customer.id;
}

export function buildCheckoutParams(input: {
  userId: number;
  customerId: string;
  priceId: string;
  planId: string;
  planName: string;
  priceMonthlyUsd: number;
  origin: string;
  automaticTax: boolean;
}) {
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: String(input.userId),
    line_items: [{ price: input.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    automatic_tax: { enabled: input.automaticTax },
    // Automatic tax needs an address on the customer; let Checkout save the one entered.
    ...(input.automaticTax ? { customer_update: { address: "auto", name: "auto" }, billing_address_collection: "required" } : {}),
    subscription_data: { metadata: { userId: String(input.userId), planId: input.planId } },
    metadata: { userId: String(input.userId), planId: input.planId },
    success_url: `${input.origin}/billing?checkout=success`,
    cancel_url: `${input.origin}/billing?checkout=cancelled`,
    custom_text: {
      submit: {
        message: `StudyScribe ${input.planName} renews every month at $${input.priceMonthlyUsd} plus any tax shown above, until you cancel. Cancel any time from Billing in StudyScribe; you keep the plan until the end of the period you paid for.`,
      },
    },
  };
}

// ----------------------------------------------------------------- webhook

async function findRowForCustomer(customerId: string | null | undefined) {
  if (!customerId) return null;
  const db = await requireDb();
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  return row ?? null;
}

async function saveState(userId: number, customerId: string, state: StoredSubscription) {
  const db = await requireDb();
  const values = {
    stripeSubscriptionId: state.stripeSubscriptionId,
    stripePriceId: state.stripePriceId,
    planId: state.planId,
    status: state.status,
    currentPeriodStart: state.currentPeriodStart,
    currentPeriodEnd: state.currentPeriodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    lastEventAt: state.lastEventAt,
  };
  await db.insert(subscriptions).values({ userId, stripeCustomerId: customerId, ...values }).onDuplicateKeyUpdate({ set: values });
}

async function userExists(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const db = await requireDb();
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return !!row;
}

/** The person a Stripe object belongs to: our row for its customer, or the userId we put in its metadata. */
async function resolveOwner(customerId: string | null, metadataUserId: unknown) {
  const row = await findRowForCustomer(customerId);
  if (row) return { userId: row.userId, row };
  const userId = Number(metadataUserId);
  return (await userExists(userId)) ? { userId, row: null } : null;
}

export type StripeEvent = { id: string; type: string; created: number; data: { object: any } };

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function applyStripeEvent(event: StripeEvent, config: StripeConfig): Promise<{ applied: boolean; reason?: string }> {
  const object = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      if (object.mode !== "subscription" || typeof object.subscription !== "string") return { applied: false, reason: "not a subscription checkout" };
      const owner = await resolveOwner(object.customer, object.client_reference_id ?? object.metadata?.userId);
      if (!owner) return { applied: false, reason: "unknown customer" };
      // The session only names the subscription; read its current state.
      const subscription = await stripeRequest("GET", `/subscriptions/${encodeURIComponent(object.subscription)}`, {}, { config });
      const next = nextSubscriptionState(toStored(owner.row), { type: event.type, created: event.created, subscription }, config);
      if (!next) return { applied: false, reason: "stale" };
      await saveState(owner.userId, object.customer, next);
      const plan = getPlan(effectivePlanId(next));
      if (plan.id !== "free") {
        await notifyUser(owner.userId, { title: `Your ${plan.name} plan is active`, message: `Thanks for subscribing. You now have ${plan.transcriptionMinutesPerMonth.toLocaleString("en-US")} minutes of transcription and ${plan.aiGenerationsPerMonth.toLocaleString("en-US")} AI generations a month.`, url: "/billing", tag: "billing" });
      }
      return { applied: true };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const owner = await resolveOwner(object.customer, object.metadata?.userId);
      if (!owner) return { applied: false, reason: "unknown customer" };
      const next = nextSubscriptionState(toStored(owner.row), { type: event.type, created: event.created, subscription: object }, config);
      if (!next) return { applied: false, reason: "stale" };
      await saveState(owner.userId, object.customer, next);
      return { applied: true };
    }
    case "invoice.payment_failed": {
      const owner = await resolveOwner(object.customer, null);
      if (!owner?.row) return { applied: false, reason: "unknown customer" };
      const next = stateAfterPaymentFailed(toStored(owner.row), event.created);
      if (next) await saveState(owner.userId, owner.row.stripeCustomerId, next);
      await notifyUser(owner.userId, {
        title: "Your payment did not go through",
        message: "Stripe will try your card again over the next few days, and your plan stays active meanwhile. Update your card from the Billing page to avoid moving to Free.",
        url: "/billing",
        tag: "billing",
      });
      return { applied: true };
    }
    default:
      return { applied: false, reason: "ignored type" };
  }
}

async function alreadyProcessed(eventId: string) {
  const db = await requireDb();
  const [row] = await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, eventId)).limit(1);
  return !!row;
}

async function markProcessed(event: StripeEvent) {
  const db = await requireDb();
  await db.insert(stripeEvents).values({ id: event.id, type: event.type.slice(0, 64) }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
}

/**
 * Handles one verified delivery. Idempotent by event id: a redelivery of an
 * event already applied returns without touching anything. The id is
 * recorded only after the event is applied, so a failure (including tables
 * not migrated yet) answers 500 and Stripe retries it later.
 */
export type WebhookDeps = {
  alreadyProcessed: (eventId: string) => Promise<boolean>;
  markProcessed: (event: StripeEvent) => Promise<void>;
  apply: (event: StripeEvent, config: StripeConfig) => Promise<{ applied: boolean; reason?: string }>;
};

const defaultDeps: WebhookDeps = { alreadyProcessed, markProcessed, apply: applyStripeEvent };

export async function handleStripeWebhookBody(raw: Buffer, signatureHeader: string | undefined, config: StripeConfig, nowSeconds?: number, deps: WebhookDeps = defaultDeps) {
  const check = verifyStripeSignature(raw, signatureHeader, config.webhookSecret, nowSeconds);
  if (!check.ok) return { status: 400, body: { error: `Signature ${check.reason}` } };
  let event: StripeEvent;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  if (typeof event?.id !== "string" || typeof event.type !== "string") return { status: 400, body: { error: "Not a Stripe event" } };
  if (!HANDLED_EVENTS.has(event.type)) return { status: 200, body: { received: true, ignored: true } };
  if (await deps.alreadyProcessed(event.id)) return { status: 200, body: { received: true, duplicate: true } };
  const result = await deps.apply(event, config);
  await deps.markProcessed(event);
  return { status: 200, body: { received: true, ...result } };
}

/** Must be registered before the global JSON parser: the signature covers the exact bytes Stripe sent. */
export function registerStripeWebhook(app: Express) {
  app.post("/api/stripe/webhook", express.raw({ type: () => true, limit: "1mb" }), async (req: Request, res: Response) => {
    const config = getStripeConfig();
    if (!config) {
      res.status(503).json({ error: "Billing is not configured on this server." });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : typeof req.body === "string" ? Buffer.from(req.body, "utf8") : null;
    if (!raw) {
      res.status(400).json({ error: "Expected the raw request body" });
      return;
    }
    try {
      const result = await handleStripeWebhookBody(raw, req.get("stripe-signature"), config);
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error("[billing] webhook failed:", error instanceof Error ? error.message : error);
      res.status(500).json({ error: "Webhook processing failed; Stripe will retry." });
    }
  });
}

// ---------------------------------------------------------- account data

/**
 * Account deletion must stop future charges first. The subscription is
 * cancelled immediately (no further invoices); if Stripe cannot be reached
 * the deletion stops, so nobody is left paying for an account that no longer
 * exists. The Stripe customer is then deleted on a best-effort basis; Stripe
 * keeps its own payment records where the law requires.
 */
export async function cancelBillingForAccountDeletion(userId: number) {
  const row = await getSubscriptionRow(userId);
  if (!row) return;
  const live = row.stripeSubscriptionId && row.status !== "canceled" && row.status !== "incomplete_expired";
  const config = getStripeConfig();
  if (live) {
    if (!config) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your subscription could not be cancelled automatically. Email us to cancel it, then delete the account." });
    }
    try {
      await stripeRequest("DELETE", `/subscriptions/${encodeURIComponent(row.stripeSubscriptionId!)}`, {}, { config });
    } catch (error) {
      if (!(error instanceof StripeApiError && error.status === 404)) {
        console.error("[billing] cancel on account deletion failed:", error instanceof Error ? error.message : error);
        throw new TRPCError({ code: "BAD_GATEWAY", message: "We could not cancel your subscription with Stripe, so the account was not deleted. Try again in a moment." });
      }
    }
  }
  if (config) {
    await stripeRequest("DELETE", `/customers/${encodeURIComponent(row.stripeCustomerId)}`, {}, { config }).catch((error) => {
      console.warn("[billing] customer delete failed:", error instanceof Error ? error.message : error);
    });
  }
  const db = await requireDb();
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
}

export async function exportBillingForUser(userId: number) {
  const row = await getSubscriptionRow(userId);
  if (!row) return null;
  return {
    plan: row.planId,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt,
  };
}

// ------------------------------------------------------------------ router

const paidPlanInput = z.enum(PAID_PLAN_IDS);

export const billingRouter = router({
  /** Public: the plans and whether paid ones can be bought on this server. */
  plans: publicProcedure.query(() => {
    const config = getStripeConfig();
    return { billingEnabled: !!config, automaticTax: config?.automaticTax ?? false, plans: withAvailability(!!config) };
  }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const [row, usage] = await Promise.all([getSubscriptionRow(ctx.user.id), getUsageSummary(ctx.user)]);
    const stored = toStored(row);
    return {
      billingEnabled: isBillingConfigured(),
      plan: usage.plan,
      subscription: row
        ? {
            status: row.status,
            description: describeStatus(stored),
            planId: row.planId,
            currentPeriodEnd: row.currentPeriodEnd,
            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
            hasPortal: true,
            live: !!row.stripeSubscriptionId && ENTITLED_STATUSES.has(row.status),
          }
        : null,
      usage: {
        enforced: usage.enforced,
        minutesUsed: usage.minutesUsed,
        minutesLimit: usage.minutesLimit,
        generationsUsed: usage.generationsUsed,
        generationsLimit: usage.generationsLimit,
        resetsOn: formatResetDate(),
      },
    };
  }),

  checkout: protectedProcedure.input(z.object({ plan: paidPlanInput })).mutation(async ({ ctx, input }) => {
    const config = requireConfig();
    if (!checkTrpcRateLimit(`billing-checkout:${ctx.user.id}`, 10 * 60 * 1000, 10)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many checkout attempts. Try again in a few minutes." });
    }
    if (!isPaidPlanId(input.plan)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown plan" });
    const current = await getSubscriptionRow(ctx.user.id);
    if (current?.stripeSubscriptionId && ENTITLED_STATUSES.has(current.status)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You already have a paid plan. Use Change plan to switch, so you are not charged twice." });
    }
    const plan = getPlan(input.plan);
    const origin = getSafeApplicationOrigin(typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : undefined);
    try {
      const customerId = await ensureCustomer(ctx.user, config);
      const session = await stripeRequest<{ url: string }>(
        "POST",
        "/checkout/sessions",
        buildCheckoutParams({ userId: ctx.user.id, customerId, priceId: config.prices[input.plan], planId: plan.id, planName: plan.name, priceMonthlyUsd: plan.priceMonthlyUsd, origin, automaticTax: config.automaticTax }),
        { config },
      );
      if (!session?.url) throw new Error("Stripe returned no checkout URL");
      return { url: session.url };
    } catch (error) {
      stripeFailure(error, "start checkout");
    }
  }),

  /** Stripe's hosted portal: change plan, update the card, see invoices, or go straight to cancelling. */
  portal: protectedProcedure.input(z.object({ intent: z.enum(["manage", "cancel"]).default("manage") })).mutation(async ({ ctx, input }) => {
    const config = requireConfig();
    const row = await getSubscriptionRow(ctx.user.id);
    if (!row) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You do not have a paid plan yet." });
    const origin = getSafeApplicationOrigin(typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : undefined);
    const cancelFlow = input.intent === "cancel" && row.stripeSubscriptionId && ENTITLED_STATUSES.has(row.status) && !row.cancelAtPeriodEnd;
    try {
      const session = await stripeRequest<{ url: string }>(
        "POST",
        "/billing_portal/sessions",
        {
          customer: row.stripeCustomerId,
          return_url: `${origin}/billing`,
          ...(cancelFlow
            ? { flow_data: { type: "subscription_cancel", subscription_cancel: { subscription: row.stripeSubscriptionId }, after_completion: { type: "redirect", redirect: { return_url: `${origin}/billing?cancelled=1` } } } }
            : {}),
        },
        { config },
      );
      if (!session?.url) throw new Error("Stripe returned no portal URL");
      return { url: session.url };
    } catch (error) {
      stripeFailure(error, "open the billing portal");
    }
  }),
});

/** Admin page: what is configured, where Stripe should send webhooks, and how many people are on each plan. */
export const billingDiagnostics = adminProcedure.query(async () => {
  const db = await getDb();
  const counts = db
    ? await tolerateMissingSchema(
        "billing",
        () => db.select({ planId: subscriptions.planId, status: subscriptions.status, count: sql<string>`COUNT(*)` }).from(subscriptions).groupBy(subscriptions.planId, subscriptions.status),
        null as Array<{ planId: string; status: string; count: string }> | null,
      )
    : null;
  const subscribers: Record<string, number> = { basic: 0, pro: 0, max: 0 };
  for (const row of counts ?? []) if (ENTITLED_STATUSES.has(row.status) && row.planId in subscribers) subscribers[row.planId] += Number(row.count);
  const origin = process.env.PUBLIC_APP_URL || process.env.APP_URL || null;
  return {
    ...describeBillingConfig(),
    limitsEnforced: limitsEnforced(),
    limitsForcedOn: process.env.USAGE_LIMITS_ENFORCED?.trim() === "true",
    tablesReady: counts !== null,
    webhookUrl: origin ? `${origin.replace(/\/$/, "")}/api/stripe/webhook` : null,
    subscribers,
  };
});
