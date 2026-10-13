import { describe, expect, it, vi } from "vitest";
import { encodeForm, getStripeConfig, signStripePayload, verifyStripeSignature, type StripeConfig } from "./stripe";
import { describeStatus, effectivePlanId, nextSubscriptionState, planForPrice, stateAfterPaymentFailed, subscriptionFields, type StoredSubscription } from "./billingState";
import { buildCheckoutParams, handleStripeWebhookBody, type StripeEvent, type WebhookDeps } from "./billing";
import { withAvailability } from "@shared/plans";

const config: StripeConfig = {
  secretKey: "sk_test_x",
  webhookSecret: "whsec_test",
  prices: { basic: "price_basic", pro: "price_pro", max: "price_max" },
  automaticTax: false,
};

const fullEnv = {
  STRIPE_SECRET_KEY: "sk_test_1",
  STRIPE_WEBHOOK_SECRET: "whsec_1",
  STRIPE_PRICE_BASIC: "price_b",
  STRIPE_PRICE_PRO: "price_p",
  STRIPE_PRICE_MAX: "price_m",
} as unknown as NodeJS.ProcessEnv;

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_start: 1_790_000_000,
    current_period_end: 1_792_600_000,
    items: { data: [{ price: { id: "price_pro" } }] },
    ...overrides,
  };
}

const stored = (overrides: Partial<StoredSubscription> = {}): StoredSubscription => ({
  planId: "pro",
  status: "active",
  stripeSubscriptionId: "sub_1",
  stripePriceId: "price_pro",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  lastEventAt: 100,
  ...overrides,
});

describe("Stripe configuration", () => {
  it("is on only when the key, webhook secret and all three prices are present", () => {
    expect(getStripeConfig(fullEnv)).not.toBeNull();
    for (const missing of Object.keys(fullEnv)) {
      expect(getStripeConfig({ ...fullEnv, [missing]: "" } as NodeJS.ProcessEnv)).toBeNull();
    }
  });

  it("reads automatic tax as an explicit opt-in", () => {
    expect(getStripeConfig(fullEnv)?.automaticTax).toBe(false);
    expect(getStripeConfig({ ...fullEnv, STRIPE_AUTOMATIC_TAX: "true" } as NodeJS.ProcessEnv)?.automaticTax).toBe(true);
  });

  it("marks paid plans purchasable only when billing is enabled", () => {
    expect(withAvailability(false).map((plan) => plan.purchasable)).toEqual([true, false, false, false]);
    expect(withAvailability(true).every((plan) => plan.purchasable)).toBe(true);
  });
});

describe("encodeForm", () => {
  it("encodes nested objects and arrays the way Stripe expects", () => {
    const body = encodeForm({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { userId: "7" }, skip: undefined });
    expect(decodeURIComponent(body)).toBe("mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[userId]=7");
  });
});

describe("webhook signatures", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const now = 1_800_000_000;

  it("accepts a correctly signed payload", () => {
    expect(verifyStripeSignature(payload, signStripePayload(payload, "whsec_test", now), "whsec_test", now)).toEqual({ ok: true });
  });

  it("rejects a tampered body, a wrong secret, a missing header and an old timestamp", () => {
    const header = signStripePayload(payload, "whsec_test", now);
    expect(verifyStripeSignature(payload.replace("evt_1", "evt_2"), header, "whsec_test", now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyStripeSignature(payload, header, "whsec_other", now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyStripeSignature(payload, undefined, "whsec_test", now)).toEqual({ ok: false, reason: "missing" });
    expect(verifyStripeSignature(payload, "garbage", "whsec_test", now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyStripeSignature(payload, header, "whsec_test", now + 301)).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts any matching v1 signature, as during a secret roll", () => {
    const good = signStripePayload(payload, "whsec_test", now).split(",")[1];
    expect(verifyStripeSignature(payload, `t=${now},v1=deadbeef,${good}`, "whsec_test", now)).toEqual({ ok: true });
  });
});

describe("subscription state", () => {
  it("maps our price ids to plans and anything else to nothing", () => {
    expect(planForPrice("price_max", config)).toBe("max");
    expect(planForPrice("price_someone_elses", config)).toBeNull();
    expect(subscriptionFields(subscription({ items: { data: [{ price: { id: "price_unknown" } }] } }), config).planId).toBe("free");
  });

  it("reads period dates from the subscription or, on newer API versions, from its item", () => {
    const fields = subscriptionFields(
      subscription({ current_period_start: undefined, current_period_end: undefined, items: { data: [{ price: { id: "price_basic" }, current_period_start: 1_790_000_000, current_period_end: 1_792_000_000 }] } }),
      config,
    );
    expect(fields.planId).toBe("basic");
    expect(fields.currentPeriodEnd?.getTime()).toBe(1_792_000_000_000);
  });

  it("only entitled statuses grant the paid plan", () => {
    expect(effectivePlanId(null)).toBe("free");
    expect(effectivePlanId({ planId: "pro", status: "active" })).toBe("pro");
    expect(effectivePlanId({ planId: "pro", status: "trialing" })).toBe("pro");
    expect(effectivePlanId({ planId: "pro", status: "past_due" })).toBe("pro");
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "none"]) {
      expect(effectivePlanId({ planId: "pro", status })).toBe("free");
    }
  });

  it("created, then cancelled at period end, then deleted", () => {
    const created = nextSubscriptionState(null, { type: "customer.subscription.created", created: 10, subscription: subscription() }, config);
    expect(created).toMatchObject({ planId: "pro", status: "active", cancelAtPeriodEnd: false, lastEventAt: 10 });

    const cancelling = nextSubscriptionState(created, { type: "customer.subscription.updated", created: 20, subscription: subscription({ cancel_at_period_end: true }) }, config);
    expect(cancelling).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(effectivePlanId(cancelling)).toBe("pro");
    expect(describeStatus(cancelling)).toMatch(/stays active until/);

    const deleted = nextSubscriptionState(cancelling, { type: "customer.subscription.deleted", created: 30, subscription: subscription({ status: "active" }) }, config);
    expect(deleted).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false, lastEventAt: 30 });
    expect(effectivePlanId(deleted)).toBe("free");
  });

  it("switching plan in the portal changes the plan", () => {
    const next = nextSubscriptionState(stored(), { type: "customer.subscription.updated", created: 200, subscription: subscription({ items: { data: [{ price: { id: "price_max" } }] } }) }, config);
    expect(next?.planId).toBe("max");
  });

  it("ignores an event older than the newest one applied", () => {
    expect(nextSubscriptionState(stored({ lastEventAt: 500 }), { type: "customer.subscription.updated", created: 400, subscription: subscription({ status: "canceled" }) }, config)).toBeNull();
  });

  it("does not let a dead old subscription replace a live new one", () => {
    const next = nextSubscriptionState(stored({ stripeSubscriptionId: "sub_new" }), { type: "customer.subscription.updated", created: 200, subscription: subscription({ id: "sub_old", status: "canceled" }) }, config);
    expect(next).toBeNull();
  });

  it("a failed payment marks the plan past due without removing it", () => {
    const next = stateAfterPaymentFailed(stored(), 300);
    expect(next).toMatchObject({ status: "past_due", lastEventAt: 300 });
    expect(effectivePlanId(next)).toBe("pro");
    expect(stateAfterPaymentFailed(stored({ status: "canceled" }), 300)).toBeNull();
    expect(stateAfterPaymentFailed(stored({ lastEventAt: 400 }), 300)).toBeNull();
  });
});

describe("checkout session", () => {
  const base = { userId: 7, customerId: "cus_1", priceId: "price_pro", planId: "pro", planName: "Pro", priceMonthlyUsd: 20, origin: "https://app.example", automaticTax: false };

  it("is a subscription with promotion codes, the user reference and renewal disclosed", () => {
    const params = buildCheckoutParams(base) as any;
    expect(params.mode).toBe("subscription");
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.client_reference_id).toBe("7");
    expect(params.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    expect(params.custom_text.submit.message).toMatch(/renews every month at \$20/);
    expect(params.custom_text.submit.message).toMatch(/Cancel any time/);
    expect(params.success_url).toBe("https://app.example/billing?checkout=success");
    expect(params.automatic_tax).toEqual({ enabled: false });
    expect(params.customer_update).toBeUndefined();
  });

  it("collects an address when automatic tax is on", () => {
    const params = buildCheckoutParams({ ...base, automaticTax: true }) as any;
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.customer_update).toEqual({ address: "auto", name: "auto" });
    expect(params.billing_address_collection).toBe("required");
  });
});

describe("webhook handler", () => {
  const now = 1_800_000_000;
  const event = (id: string, type = "customer.subscription.updated"): StripeEvent => ({ id, type, created: now, data: { object: subscription() } });

  function memoryDeps(apply?: WebhookDeps["apply"]) {
    const processed = new Set<string>();
    const applied: string[] = [];
    const deps: WebhookDeps = {
      alreadyProcessed: async (id) => processed.has(id),
      markProcessed: async (e) => void processed.add(e.id),
      apply: apply ?? (async (e) => { applied.push(e.id); return { applied: true }; }),
    };
    return { deps, processed, applied };
  }

  async function deliver(e: StripeEvent, deps: WebhookDeps, secret = "whsec_test") {
    const raw = Buffer.from(JSON.stringify(e));
    return handleStripeWebhookBody(raw, signStripePayload(raw.toString(), secret, now), config, now, deps);
  }

  it("rejects an unsigned or wrongly signed delivery before reading it", async () => {
    const { deps, applied } = memoryDeps();
    const result = await deliver(event("evt_bad"), deps, "whsec_wrong");
    expect(result.status).toBe(400);
    expect(applied).toEqual([]);
  });

  it("applies an event once, however many times it is delivered", async () => {
    const { deps, applied } = memoryDeps();
    const first = await deliver(event("evt_1"), deps);
    const second = await deliver(event("evt_1"), deps);
    expect(first).toMatchObject({ status: 200, body: { received: true, applied: true } });
    expect(second).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(applied).toEqual(["evt_1"]);
  });

  it("acknowledges event types it does not handle without applying them", async () => {
    const { deps, applied } = memoryDeps();
    const result = await deliver(event("evt_2", "charge.refunded"), deps);
    expect(result.body).toMatchObject({ ignored: true });
    expect(applied).toEqual([]);
  });

  it("does not mark an event processed when applying it fails, so Stripe's retry is applied", async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error("Table 'subscriptions' doesn't exist")).mockResolvedValue({ applied: true });
    const { deps, processed } = memoryDeps(failing);
    await expect(deliver(event("evt_3"), deps)).rejects.toThrow();
    expect(processed.has("evt_3")).toBe(false);
    await expect(deliver(event("evt_3"), deps)).resolves.toMatchObject({ status: 200 });
    expect(processed.has("evt_3")).toBe(true);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
