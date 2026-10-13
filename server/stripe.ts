import { createHmac, timingSafeEqual } from "crypto";
import type { PaidPlanId } from "@shared/plans";

/**
 * A small Stripe client over the REST API (form-encoded requests, JSON
 * responses), so billing needs no SDK dependency. Only what StudyScribe uses:
 * customers, Checkout Sessions, billing portal sessions, subscriptions, and
 * webhook signature checks. Card details never pass through this server:
 * people pay on Stripe's hosted Checkout page and manage cards in Stripe's
 * hosted portal.
 */

const DEFAULT_API_BASE = "https://api.stripe.com/v1";
const HTTP_TIMEOUT_MS = 20_000;
/** Stripe's own libraries reject signatures older than five minutes. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  prices: Record<PaidPlanId, string>;
  /** Yearly prices (STRIPE_PRICE_BASIC_YEARLY etc.); yearly billing is offered only when all three are set. */
  yearlyPrices?: Record<PaidPlanId, string> | null;
  automaticTax: boolean;
};

/** Billing is on only when every value is present; anything less keeps paid plans at "Coming soon". */
export function getStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const basic = env.STRIPE_PRICE_BASIC?.trim();
  const pro = env.STRIPE_PRICE_PRO?.trim();
  const max = env.STRIPE_PRICE_MAX?.trim();
  if (!secretKey || !webhookSecret || !basic || !pro || !max) return null;
  const basicYearly = env.STRIPE_PRICE_BASIC_YEARLY?.trim();
  const proYearly = env.STRIPE_PRICE_PRO_YEARLY?.trim();
  const maxYearly = env.STRIPE_PRICE_MAX_YEARLY?.trim();
  const yearlyPrices = basicYearly && proYearly && maxYearly ? { basic: basicYearly, pro: proYearly, max: maxYearly } : null;
  return { secretKey, webhookSecret, prices: { basic, pro, max }, yearlyPrices, automaticTax: env.STRIPE_AUTOMATIC_TAX?.trim() === "true" };
}

/** Whether checkout can offer yearly billing. */
export function isYearlyBillingConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(getStripeConfig(env)?.yearlyPrices);
}

export function isBillingConfigured(env: NodeJS.ProcessEnv = process.env) {
  return getStripeConfig(env) !== null;
}

/** What the Admin page shows: which pieces are present, never their values. */
export function describeBillingConfig(env: NodeJS.ProcessEnv = process.env) {
  const has = (name: string) => Boolean(env[name]?.trim());
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  return {
    configured: isBillingConfigured(env),
    mode: secret.startsWith("sk_live_") || secret.startsWith("rk_live_") ? "live" : secret ? "test" : null,
    secretKey: has("STRIPE_SECRET_KEY"),
    webhookSecret: has("STRIPE_WEBHOOK_SECRET"),
    prices: { basic: has("STRIPE_PRICE_BASIC"), pro: has("STRIPE_PRICE_PRO"), max: has("STRIPE_PRICE_MAX") },
    yearlyPrices: { basic: has("STRIPE_PRICE_BASIC_YEARLY"), pro: has("STRIPE_PRICE_PRO_YEARLY"), max: has("STRIPE_PRICE_MAX_YEARLY") },
    yearly: isYearlyBillingConfigured(env),
    automaticTax: env.STRIPE_AUTOMATIC_TAX?.trim() === "true",
    usingTestApi: Boolean(apiBase(env) !== DEFAULT_API_BASE),
  };
}

/** STRIPE_API_BASE points requests at a local mock; ignored in production so keys can never be sent elsewhere. */
export function apiBase(env: NodeJS.ProcessEnv = process.env) {
  const override = env.NODE_ENV !== "production" ? env.STRIPE_API_BASE?.trim().replace(/\/$/, "") : undefined;
  return override || DEFAULT_API_BASE;
}

/** Stripe's form encoding: nested objects as `a[b][c]=v`, arrays as `a[0]=v`. */
export function encodeForm(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
    } else if (typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) walk(`${prefix}[${key}]`, inner);
    } else {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return pairs.join("&");
}

export class StripeApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function stripeRequest<T = any>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
  options: { idempotencyKey?: string; config?: StripeConfig } = {},
): Promise<T> {
  const config = options.config ?? getStripeConfig();
  if (!config) throw new StripeApiError("Billing is not set up on this server.", 503);
  const body = encodeForm(params);
  const url = method === "GET" && body ? `${apiBase()}${path}?${body}` : `${apiBase()}${path}`;
  const headers: Record<string, string> = { authorization: `Bearer ${config.secretKey}` };
  if (method !== "GET") headers["content-type"] = "application/x-www-form-urlencoded";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  const response = await fetch(url, {
    method,
    headers,
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new StripeApiError(json?.error?.message ?? `Stripe returned ${response.status}`, response.status, json?.error?.code);
  }
  return json as T;
}

// ------------------------------------------------------------- signatures

/** Builds a `Stripe-Signature` header; used by tests and the local mock sender. */
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

/**
 * Verifies a webhook the way Stripe documents it: HMAC-SHA256 of
 * `${t}.${rawBody}` with the endpoint secret, compared in constant time
 * against every `v1` signature in the header, with a five-minute window
 * against replays.
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing" };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((item) => item?.trim());
    if (key === "t" && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: "expired" };
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex"), "utf8");
  for (const candidate of signatures) {
    const given = Buffer.from(candidate, "utf8");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}
