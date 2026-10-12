import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lt, lte } from "drizzle-orm";
import { Agent, fetch as undiciFetch } from "undici";
import { z } from "zod";
import { webhookDeliveries, webhookEndpoints } from "../drizzle/schema";
import {
  MAX_WEBHOOKS_PER_USER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEvent,
} from "@shared/webhooks";
import { getDb } from "./db";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { decryptSecret, encryptSecret } from "./tokenCrypto";
import { isDisallowedAddress } from "./urlAudioImport";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Outgoing webhooks (E4). Each person can register a few HTTPS endpoints and
 * pick events. Deliveries are JSON, signed with HMAC-SHA256 over
 * `<timestamp>.<body>` (Stripe-style), and sent from the request that caused
 * the event with a short timeout, because Vercel functions have no background
 * workers. A failed delivery is recorded with a retry time; due retries run
 * opportunistically (after the person's next event, when they open the
 * Webhooks settings) and from the existing daily cron, with backoff, up to
 * MAX_ATTEMPTS attempts. The settings page can also send a test or redeliver.
 *
 * The URL is user-supplied, so this is an SSRF surface like link import: the
 * host is resolved and every address must be public, the connection is pinned
 * to the address that was checked (no DNS rebinding between check and
 * connect), and redirects are never followed.
 */

export const DELIVERY_TIMEOUT_MS = 5_000;
export const MAX_ATTEMPTS = 6;
/** Delay before attempt n+1, after n failed attempts (1 minute, 10 minutes, 1 hour, 6 hours, 1 day). */
export const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
const MAX_PAYLOAD_TEXT_CHARS = 100_000;
const DELIVERY_RETENTION_DAYS = 30;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

// ---------------------------------------------------------------- signing

export function signWebhookPayload(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Receiver-side check, exported for tests and documented on the Help page. */
export function verifyWebhookSignature(secret: string, body: string, header: string, options: { toleranceSeconds?: number; nowSeconds?: number } = {}): boolean {
  const parts = Object.fromEntries(
    header.split(",").map(part => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
  const given = Buffer.from(String(parts.v1));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function nextRetryDelay(failedAttempts: number): number | null {
  if (failedAttempts >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.min(failedAttempts - 1, RETRY_DELAYS_MS.length - 1)] ?? null;
}

// ---------------------------------------------------------------- SSRF guard

/** Local development and tests can deliver to a receiver on this machine; production never can. */
export function privateTargetsAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.WEBHOOKS_ALLOW_PRIVATE_TARGETS === "true";
}

export type ResolvedTarget = { url: URL; address: string; family: 4 | 6 };

export async function resolveWebhookTarget(
  rawUrl: string,
  options: { allowPrivate?: boolean; resolve?: (host: string) => Promise<Array<{ address: string; family: number }>> } = {},
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Webhook URLs must start with https:// (or http://).");
  if (url.username || url.password) throw new Error("Put credentials in the receiver, not in the webhook URL.");
  const allowPrivate = options.allowPrivate ?? privateTargetsAllowed();

  const literal = url.hostname.replace(/^\[|\]$/g, "");
  let candidates: Array<{ address: string; family: number }>;
  if (net.isIP(literal)) {
    candidates = [{ address: literal, family: net.isIP(literal) }];
  } else {
    if (!allowPrivate && (literal === "localhost" || literal.endsWith(".localhost") || literal.endsWith(".internal") || literal.endsWith(".local"))) {
      throw new Error("Webhook URLs must point to a public address.");
    }
    try {
      candidates = await (options.resolve ?? (host => lookup(host, { all: true })))(url.hostname);
    } catch {
      throw new Error("The webhook URL's domain could not be resolved.");
    }
  }
  if (candidates.length === 0) throw new Error("The webhook URL's domain could not be resolved.");
  if (!allowPrivate && candidates.some(entry => isDisallowedAddress(entry.address))) {
    throw new Error("Webhook URLs must point to a public address.");
  }
  const chosen = candidates[0];
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

export type DeliveryResult = { ok: boolean; status: number | null; error: string | null; durationMs: number };

/** One POST, pinned to the checked address, no redirects, short timeout. Never throws. */
export async function postSigned(target: ResolvedTarget, body: string, headers: Record<string, string>, timeoutMs = DELIVERY_TIMEOUT_MS): Promise<DeliveryResult> {
  const started = Date.now();
  const agent = new Agent({
    connect: {
      timeout: timeoutMs,
      lookup: (_hostname: string, opts: any, callback: (...args: any[]) => void) => {
        if (opts && opts.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
    },
  });
  try {
    const response = await undiciFetch(target.url, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "user-agent": "StudyScribe-Webhooks/1.0", ...headers },
      redirect: "manual",
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Read a little so the connection can close cleanly; the body itself is ignored.
    await response.text().catch(() => "");
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: "The receiver answered with a redirect. Webhooks do not follow redirects; use the final URL.", durationMs: Date.now() - started };
    }
    const ok = response.status >= 200 && response.status < 300;
    return { ok, status: response.status, error: ok ? null : `The receiver answered ${response.status}.`, durationMs: Date.now() - started };
  } catch (error) {
    const name = (error as Error)?.name;
    const message = name === "TimeoutError" || name === "AbortError" ? `No answer within ${timeoutMs / 1000} seconds.` : `Could not connect: ${(error as Error)?.message || "unknown error"}`;
    return { ok: false, status: null, error: message.slice(0, 480), durationMs: Date.now() - started };
  } finally {
    agent.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- delivery

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export function parseEvents(value: string): WebhookEvent[] {
  return value.split(",").map(part => part.trim()).filter((part): part is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(part));
}

async function attempt(db: Db, endpoint: EndpointRow, delivery: DeliveryRow): Promise<DeliveryResult> {
  let result: DeliveryResult;
  try {
    const target = await resolveWebhookTarget(endpoint.url);
    const secret = decryptSecret(endpoint.secret, "webhook-secret");
    const timestamp = Math.floor(Date.now() / 1000);
    result = await postSigned(target, delivery.payload, {
      [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(secret, delivery.payload, timestamp),
      [WEBHOOK_EVENT_HEADER]: delivery.event,
      [WEBHOOK_DELIVERY_HEADER]: delivery.deliveryId,
    });
  } catch (error) {
    result = { ok: false, status: null, error: (error instanceof Error ? error.message : "Delivery failed").slice(0, 480), durationMs: 0 };
  }
  const attempts = delivery.attempts + 1;
  const delay = result.ok ? null : nextRetryDelay(attempts);
  await db
    .update(webhookDeliveries)
    .set({
      attempts,
      status: result.ok ? "succeeded" : delay === null ? "failed" : "pending",
      responseStatus: result.status,
      error: result.error,
      lastAttemptAt: new Date(),
      nextAttemptAt: delay === null ? null : new Date(Date.now() + delay),
    })
    .where(eq(webhookDeliveries.id, delivery.id));
  return result;
}

function appUrl(path: string) {
  const base = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export function buildEnvelope(event: string, data: Record<string, unknown>, deliveryId: string, now = new Date()) {
  return JSON.stringify({ id: deliveryId, event, createdAt: now.toISOString(), data });
}

/** Trims a transcript for a payload so one delivery stays reasonable. */
export function payloadText(text: string) {
  return text.length > MAX_PAYLOAD_TEXT_CHARS ? { text: text.slice(0, MAX_PAYLOAD_TEXT_CHARS), truncated: true } : { text, truncated: false };
}

async function createDelivery(db: Db, endpoint: EndpointRow, event: string, data: Record<string, unknown>) {
  const deliveryId = `dlv_${randomBytes(12).toString("base64url")}`;
  const payload = buildEnvelope(event, data, deliveryId);
  const [result] = await db.insert(webhookDeliveries).values({ endpointId: endpoint.id, userId: endpoint.userId, event, deliveryId, payload, status: "pending", attempts: 0, nextAttemptAt: new Date() });
  const id = Number((result as any).insertId);
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1);
  return row;
}

/**
 * Sends an event to every enabled endpoint of the person that wants it. Runs
 * inside the request that caused the event; endpoints are tried in parallel,
 * each with a 5s timeout. Never throws: a broken receiver must not fail a
 * transcription or a note.
 */
export async function emitWebhookEvent(userId: number, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const db = await requireDb();
    const endpoints = await tolerateMissingSchema(
      "webhooks",
      () => db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.userId, userId), eq(webhookEndpoints.enabled, true))),
      [] as EndpointRow[],
    );
    const wanted = endpoints.filter(endpoint => parseEvents(endpoint.events).includes(event));
    await Promise.all(
      wanted.map(async endpoint => {
        const delivery = await createDelivery(db, endpoint, event, data);
        if (delivery) await attempt(db, endpoint, delivery);
      }),
    );
    if (wanted.length > 0) await retryDueDeliveries({ userId, limit: 2 });
  } catch (error) {
    console.error(`[webhooks] ${event} for user ${userId} failed:`, error instanceof Error ? error.message : error);
  }
}

/** Runs retries whose time has come. Bounded by `limit` and a deadline so it fits in one function call. */
export async function retryDueDeliveries(options: { userId?: number; limit: number; deadlineMs?: number }): Promise<{ attempted: number; succeeded: number }> {
  const db = await requireDb();
  const due = await tolerateMissingSchema(
    "webhooks",
    () =>
      db
        .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
        .from(webhookDeliveries)
        .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
        .where(
          and(
            eq(webhookDeliveries.status, "pending"),
            lte(webhookDeliveries.nextAttemptAt, new Date()),
            eq(webhookEndpoints.enabled, true),
            options.userId !== undefined ? eq(webhookDeliveries.userId, options.userId) : undefined,
          ),
        )
        .orderBy(asc(webhookDeliveries.nextAttemptAt))
        .limit(options.limit),
    [] as Array<{ delivery: DeliveryRow; endpoint: EndpointRow }>,
  );
  const deadline = Date.now() + (options.deadlineMs ?? 15_000);
  let attempted = 0;
  let succeeded = 0;
  for (const row of due) {
    if (Date.now() + DELIVERY_TIMEOUT_MS > deadline) break;
    attempted += 1;
    if ((await attempt(db, row.endpoint, row.delivery)).ok) succeeded += 1;
  }
  return { attempted, succeeded };
}

/** Daily cron housekeeping: retry what is due and drop delivery logs older than 30 days. */
export async function runWebhookMaintenance() {
  const retried = await retryDueDeliveries({ limit: 50, deadlineMs: 40_000 });
  const db = await requireDb();
  await tolerateMissingSchema(
    "webhooks",
    () => db.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, new Date(Date.now() - DELIVERY_RETENTION_DAYS * 24 * 60 * 60_000))),
    undefined,
  );
  return retried;
}

// ---------------------------------------------------------------- event helpers

export function recordingSummary(recording: { id: number; title: string; duration?: number | null; createdAt?: Date | string }) {
  return { id: recording.id, title: recording.title, duration: recording.duration ?? null, createdAt: recording.createdAt ?? null, url: appUrl(`/recording/${recording.id}`) };
}

// ---------------------------------------------------------------- cleanup

export async function deleteWebhooksForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema(
    "webhooks",
    async () => {
      await db.delete(webhookDeliveries).where(eq(webhookDeliveries.userId, userId));
      await db.delete(webhookEndpoints).where(eq(webhookEndpoints.userId, userId));
    },
    undefined,
  );
}

export async function exportWebhooksForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "webhooks",
    async () => ({
      webhookEndpoints: (await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.userId, userId))).map(({ secret, ...rest }) => rest),
      webhookDeliveries: (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.userId, userId))).map(({ payload, ...rest }) => rest),
    }),
    { webhookEndpoints: [], webhookDeliveries: [] },
  );
}

// ---------------------------------------------------------------- router

const FEATURE = "Webhooks";
const eventsInput = z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event");

async function ownEndpoint(db: Db, id: number, userId: number) {
  const [endpoint] = await explainMissingSchema(FEATURE, () => db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId))).limit(1));
  if (!endpoint) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
  return endpoint;
}

async function checkUrl(url: string) {
  try {
    await resolveWebhookTarget(url);
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "That URL cannot be used." });
  }
}

function shapeDelivery(row: DeliveryRow) {
  const { payload, ...rest } = row;
  return rest;
}

export const webhooksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const endpoints = await tolerateMissingSchema(
      "webhooks",
      () => db.select().from(webhookEndpoints).where(eq(webhookEndpoints.userId, ctx.user.id)).orderBy(asc(webhookEndpoints.createdAt)),
      null as EndpointRow[] | null,
    );
    if (endpoints === null) return { available: false, endpoints: [] };
    // Opening the page is a good moment to catch up on retries that are due.
    if (endpoints.length) await retryDueDeliveries({ userId: ctx.user.id, limit: 3, deadlineMs: 12_000 });
    const ids = endpoints.map(endpoint => endpoint.id);
    const deliveries = ids.length
      ? await db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.endpointId, ids)).orderBy(desc(webhookDeliveries.createdAt)).limit(100)
      : [];
    return {
      available: true,
      endpoints: endpoints.map(endpoint => ({
        id: endpoint.id,
        url: endpoint.url,
        description: endpoint.description,
        events: parseEvents(endpoint.events),
        enabled: endpoint.enabled,
        createdAt: endpoint.createdAt,
        deliveries: deliveries.filter(row => row.endpointId === endpoint.id).slice(0, 10).map(shapeDelivery),
      })),
    };
  }),

  create: protectedProcedure
    .input(z.object({ url: z.string().trim().min(8).max(2048), description: z.string().trim().max(120).optional(), events: eventsInput }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const existing = await explainMissingSchema(FEATURE, () => db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.userId, ctx.user.id)));
      if (existing.length >= MAX_WEBHOOKS_PER_USER) throw new TRPCError({ code: "BAD_REQUEST", message: `You can have up to ${MAX_WEBHOOKS_PER_USER} webhooks.` });
      await checkUrl(input.url);
      const secret = newWebhookSecret();
      await db.insert(webhookEndpoints).values({
        userId: ctx.user.id,
        url: input.url,
        description: input.description || null,
        events: input.events.join(","),
        secret: encryptSecret(secret, "webhook-secret"),
        enabled: true,
      });
      // The signing secret is shown once; after this only a new one can be made.
      return { secret };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), url: z.string().trim().min(8).max(2048).optional(), description: z.string().trim().max(120).optional(), events: eventsInput.optional(), enabled: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const endpoint = await ownEndpoint(db, input.id, ctx.user.id);
      if (input.url !== undefined) await checkUrl(input.url);
      const changes: Partial<EndpointRow> = {};
      if (input.url !== undefined) changes.url = input.url;
      if (input.description !== undefined) changes.description = input.description || null;
      if (input.events !== undefined) changes.events = input.events.join(",");
      if (input.enabled !== undefined) changes.enabled = input.enabled;
      if (Object.keys(changes).length) await db.update(webhookEndpoints).set(changes).where(eq(webhookEndpoints.id, endpoint.id));
      return { id: endpoint.id };
    }),

  rotateSecret: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const endpoint = await ownEndpoint(db, input.id, ctx.user.id);
    const secret = newWebhookSecret();
    await db.update(webhookEndpoints).set({ secret: encryptSecret(secret, "webhook-secret") }).where(eq(webhookEndpoints.id, endpoint.id));
    return { secret };
  }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const endpoint = await ownEndpoint(db, input.id, ctx.user.id);
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpoint.id));
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id));
    return { removed: true };
  }),

  sendTest: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    if (!checkTrpcRateLimit(`webhook-test:${ctx.user.id}`, 60_000, 10)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Wait a minute before sending more tests." });
    const db = await requireDb();
    const endpoint = await ownEndpoint(db, input.id, ctx.user.id);
    const delivery = await createDelivery(db, endpoint, "webhook.test", { message: "This is a test delivery from StudyScribe.", endpointId: endpoint.id });
    const result = await attempt(db, endpoint, delivery);
    return result;
  }),

  redeliver: protectedProcedure.input(z.object({ deliveryId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    if (!checkTrpcRateLimit(`webhook-test:${ctx.user.id}`, 60_000, 10)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Wait a minute before redelivering more." });
    const db = await requireDb();
    const [delivery] = await explainMissingSchema(FEATURE, () => db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.id, input.deliveryId), eq(webhookDeliveries.userId, ctx.user.id))).limit(1));
    if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "Delivery not found" });
    const endpoint = await ownEndpoint(db, delivery.endpointId, ctx.user.id);
    // A manual redelivery gets a fresh retry budget if it fails again.
    return attempt(db, endpoint, { ...delivery, attempts: 0 });
  }),
});
