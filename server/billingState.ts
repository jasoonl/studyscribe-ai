import { PAID_PLAN_IDS, type PlanId } from "@shared/plans";
import type { StripeConfig } from "./stripe";

/**
 * Pure rules for turning what Stripe reports into what StudyScribe stores and
 * which plan a person gets. No I/O here, so every transition is unit tested.
 */

/** Statuses that keep the paid plan. `past_due` keeps it while Stripe retries the card (Smart Retries), so a bank hiccup does not cut someone off mid-lecture. */
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

export type StoredSubscription = {
  planId: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastEventAt: number;
};

/** The plan a Stripe price belongs to, monthly or yearly. */
export function planForPrice(priceId: string | null | undefined, config: Pick<StripeConfig, "prices" | "yearlyPrices">): PlanId | null {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_IDS) if (config.prices[plan] === priceId || config.yearlyPrices?.[plan] === priceId) return plan;
  return null;
}

/** "year" for one of the yearly prices, "month" otherwise. */
export function intervalForPrice(priceId: string | null | undefined, config: Pick<StripeConfig, "yearlyPrices"> | null): "month" | "year" {
  if (!priceId || !config?.yearlyPrices) return "month";
  return PAID_PLAN_IDS.some(plan => config.yearlyPrices?.[plan] === priceId) ? "year" : "month";
}

export function effectivePlanId(row: Pick<StoredSubscription, "planId" | "status"> | null | undefined): PlanId {
  if (!row || !ENTITLED_STATUSES.has(row.status)) return "free";
  return (PAID_PLAN_IDS as readonly string[]).includes(row.planId) ? (row.planId as PlanId) : "free";
}

const toDate = (seconds: unknown) => (typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000) : null);

/**
 * The fields to store from a Stripe Subscription object. Newer API versions
 * moved the period dates from the subscription onto its items, so both are
 * read. A price that is not one of ours maps to "free" rather than guessing.
 */
export function subscriptionFields(subscription: any, config: Pick<StripeConfig, "prices" | "yearlyPrices">) {
  const item = subscription?.items?.data?.[0];
  const priceId: string | null = item?.price?.id ?? subscription?.plan?.id ?? null;
  const status: string = typeof subscription?.status === "string" ? subscription.status : "incomplete";
  return {
    stripeSubscriptionId: typeof subscription?.id === "string" ? subscription.id : null,
    stripePriceId: priceId,
    planId: planForPrice(priceId, config) ?? "free",
    status,
    currentPeriodStart: toDate(subscription?.current_period_start ?? item?.current_period_start),
    currentPeriodEnd: toDate(subscription?.current_period_end ?? item?.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end) || (typeof subscription?.cancel_at === "number" && status !== "canceled"),
  };
}

/** An event older than the newest one already applied must not overwrite it (Stripe does not guarantee delivery order). */
export function isStale(lastEventAt: number, eventCreated: number) {
  return eventCreated < lastEventAt;
}

/**
 * The next stored state for a subscription event, or null when nothing should
 * change. `deleted` events always end the plan, whatever the payload says.
 */
export function nextSubscriptionState(
  current: StoredSubscription | null,
  event: { type: string; created: number; subscription: any },
  config: Pick<StripeConfig, "prices" | "yearlyPrices">,
): StoredSubscription | null {
  if (current && isStale(current.lastEventAt, event.created)) return null;
  const fields = subscriptionFields(event.subscription, config);
  // A different subscription than the one on file (an old one being updated
  // after a new one started) must not replace the current, live one.
  if (
    current?.stripeSubscriptionId &&
    fields.stripeSubscriptionId &&
    current.stripeSubscriptionId !== fields.stripeSubscriptionId &&
    ENTITLED_STATUSES.has(current.status) &&
    !ENTITLED_STATUSES.has(fields.status)
  ) {
    return null;
  }
  if (event.type === "customer.subscription.deleted") {
    return { ...fields, status: "canceled", cancelAtPeriodEnd: false, lastEventAt: event.created };
  }
  return { ...fields, lastEventAt: event.created };
}

/** After `invoice.payment_failed`: keep the plan (Stripe retries) but record that payment is overdue. */
export function stateAfterPaymentFailed(current: StoredSubscription | null, eventCreated: number): StoredSubscription | null {
  if (!current || isStale(current.lastEventAt, eventCreated)) return null;
  if (current.status !== "active" && current.status !== "trialing") return null;
  return { ...current, status: "past_due", lastEventAt: eventCreated };
}

// ------------------------------------------------------------------ teams

export type TeamSubscriptionState = {
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
  seats: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastEventAt: number;
};

/**
 * The team's next stored state for a subscription event (F3), or null when
 * it is older than what is stored. The seat count is the quantity of the
 * team price's line item; a deleted subscription leaves no paid seats.
 */
export function nextTeamState(
  current: Pick<TeamSubscriptionState, "lastEventAt" | "stripeSubscriptionId" | "subscriptionStatus"> | null,
  event: { type: string; created: number; subscription: any },
  teamPriceId: string,
): TeamSubscriptionState | null {
  if (current && isStale(current.lastEventAt, event.created)) return null;
  const subscription = event.subscription ?? {};
  const items: any[] = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const item = items.find((candidate) => candidate?.price?.id === teamPriceId) ?? items[0];
  const status: string = typeof subscription.status === "string" ? subscription.status : "incomplete";
  const id = typeof subscription.id === "string" ? subscription.id : null;
  // An older subscription being cancelled must not end a newer live one.
  if (current?.stripeSubscriptionId && id && current.stripeSubscriptionId !== id && ENTITLED_STATUSES.has(current.subscriptionStatus) && !ENTITLED_STATUSES.has(status)) return null;
  const deleted = event.type === "customer.subscription.deleted";
  return {
    stripeSubscriptionId: id,
    subscriptionStatus: deleted ? "canceled" : status,
    seats: deleted ? 0 : Math.max(0, Number(item?.quantity ?? subscription.quantity ?? 0) || 0),
    currentPeriodEnd: toDate(subscription.current_period_end ?? item?.current_period_end),
    cancelAtPeriodEnd: !deleted && (Boolean(subscription.cancel_at_period_end) || (typeof subscription.cancel_at === "number" && status !== "canceled")),
    lastEventAt: event.created,
  };
}

export function teamIsEntitled(row: { subscriptionStatus: string } | null | undefined) {
  return !!row && ENTITLED_STATUSES.has(row.subscriptionStatus);
}

/** Plain-language status for the Billing page. */
export function describeStatus(row: Pick<StoredSubscription, "status" | "cancelAtPeriodEnd" | "currentPeriodEnd"> | null) {
  if (!row || row.status === "none") return null;
  const end = row.currentPeriodEnd ? row.currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  switch (row.status) {
    case "active":
    case "trialing":
      return row.cancelAtPeriodEnd ? (end ? `Cancelled. Your plan stays active until ${end}, then moves to Free.` : "Cancelled. Your plan stays active until the end of this period.") : end ? `Renews on ${end}.` : "Active.";
    case "past_due":
      return "Your last payment did not go through. Stripe will try again; update your card in the billing portal to keep your plan.";
    case "unpaid":
      return "Payment failed several times, so the plan is paused. Update your card in the billing portal.";
    case "canceled":
      return "Cancelled. You are on the Free plan.";
    case "incomplete":
      return "Checkout was not completed.";
    case "incomplete_expired":
      return "Checkout expired before payment. You are on the Free plan.";
    case "paused":
      return "Paused. You are on the Free plan until it resumes.";
    default:
      return null;
  }
}
