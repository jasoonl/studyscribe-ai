import { sql } from "drizzle-orm";
import { getAppSetting, getDb, setAppSetting } from "./db";
import { getEmbeddingConfig } from "./embeddings";
import { getBrowserPushConfiguration } from "./pushNotifications";
import { describeRecallConfig, getRecallConfig } from "./recall";
import { getTransferReport, transferLevel, type TransferTotals } from "./blobTransfer";
import { getBlobUsage, isVercelBlobStorageConfigured } from "./storage";
import { getStripeConfig, stripeRequest } from "./stripe";
import { describeWorkosConfig, getWorkosConfig } from "./workos";

/**
 * Admin "System health" (Phase 6): one live check per configured service, run
 * in parallel with a short timeout each, so the page answers well inside the
 * 60s function limit. Results carry a status and a plain sentence, never a
 * key, a token, a full URL with credentials or a provider's raw error body.
 */
export type HealthStatus = "ok" | "warn" | "error" | "off";
export type HealthCheck = { id: string; label: string; status: HealthStatus; detail: string; latencyMs: number | null };

export const CHECK_TIMEOUT_MS = 5_000;
export const CRON_LAST_RUN_KEY = "cron_last_run";
/** The cron is daily; a run older than this means it stopped. */
export const CRON_STALE_HOURS = 26;

async function timed(run: () => Promise<Omit<HealthCheck, "id" | "label" | "latencyMs">>): Promise<Omit<HealthCheck, "id" | "label">> {
  const started = Date.now();
  try {
    const result = await Promise.race([
      run(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)),
    ]);
    return { ...result, latencyMs: Date.now() - started };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "timeout";
    return { status: "error", detail: timedOut ? `No answer within ${CHECK_TIMEOUT_MS / 1000} seconds.` : describeFailure(error), latencyMs: Date.now() - started };
  }
}

/** A failure as a short sentence without secrets: only the error's class and an HTTP status if there is one. */
export function describeFailure(error: unknown): string {
  if (error && typeof error === "object" && "status" in error && typeof (error as any).status === "number") return `The service answered ${(error as any).status}.`;
  if (error instanceof TypeError) return "Could not connect.";
  return "The check failed.";
}

/** Status from an HTTP answer: 2xx ok, 401/403 means the key is wrong, anything else is an outage. */
export function statusFromResponse(status: number, what: string): Omit<HealthCheck, "id" | "label" | "latencyMs"> {
  if (status >= 200 && status < 300) return { status: "ok", detail: `${what} answered.` };
  if (status === 401 || status === 403) return { status: "error", detail: `${what} refused the key (${status}). Check the key in the environment.` };
  if (status === 429) return { status: "warn", detail: `${what} is rate limiting requests (429).` };
  return { status: "error", detail: `${what} answered ${status}.` };
}

export function storageStatus(usage: { configured: boolean; totalBytes: number; limitBytes: number }): Omit<HealthCheck, "id" | "label" | "latencyMs"> {
  if (!usage.configured) return { status: process.env.BUILT_IN_FORGE_API_URL ? "warn" : "error", detail: process.env.BUILT_IN_FORGE_API_URL ? "Vercel Blob is not configured; using the legacy Forge storage." : "No storage is configured, so uploads fail." };
  const share = usage.limitBytes > 0 ? usage.totalBytes / usage.limitBytes : 0;
  const used = `${(usage.totalBytes / 1024 ** 3).toFixed(2)} GB of ${(usage.limitBytes / 1024 ** 3).toFixed(1)} GB used (${Math.round(share * 100)}%).`;
  if (share >= 0.95) return { status: "error", detail: `${used} Blob suspends a store over its limit; free space or raise the plan.` };
  if (share >= 0.8) return { status: "warn", detail: `${used} Getting close to the limit.` };
  return { status: "ok", detail: used };
}

/** Monthly Blob transfer: warn at 80% of the allowance, error at 95% (the soft cap, where shared playback pauses). */
export function transferStatus(totals: TransferTotals, limitBytes: number): Omit<HealthCheck, "id" | "label" | "latencyMs"> {
  const used = Math.max(totals.served, totals.fetched);
  const gb = (n: number) => (n / 1024 ** 3).toFixed(2);
  const text = `${gb(used)} GB of ${gb(limitBytes)} GB transferred this month (${Math.round((used / limitBytes) * 100)}%; ${gb(totals.fetched)} GB fetched from Blob, ${gb(totals.served)} GB sent to browsers).`;
  const level = transferLevel(totals, limitBytes);
  if (level === "error") return { status: "error", detail: `${text} Shared playback and link imports are paused to keep the store from being suspended.` };
  if (level === "warn") return { status: "warn", detail: `${text} Getting close to the free allowance.` };
  return { status: "ok", detail: text };
}

export function cronStatus(lastRun: Date | null, now = new Date()): Omit<HealthCheck, "id" | "label" | "latencyMs"> {
  if (!process.env.CRON_SECRET) return { status: "off", detail: "CRON_SECRET is not set, so the daily run (reminders, webhook retries, digests) is off." };
  if (!lastRun) return { status: "warn", detail: "No daily run recorded yet." };
  const hours = (now.getTime() - lastRun.getTime()) / 3_600_000;
  const when = `Last run ${hours < 1 ? "less than an hour" : `${Math.round(hours)} hours`} ago.`;
  return hours > CRON_STALE_HOURS ? { status: "error", detail: `${when} It runs daily, so it has stopped.` } : { status: "ok", detail: when };
}

export async function recordCronRun(at = new Date()) {
  try {
    await setAppSetting(CRON_LAST_RUN_KEY, at.toISOString());
  } catch (error) {
    console.warn("[health] could not record the cron run", error instanceof Error ? error.message : error);
  }
}

const off = (detail: string) => async (): Promise<Omit<HealthCheck, "id" | "label">> => ({ status: "off", detail, latencyMs: null });

/**
 * Resend: lists domains to check the key and that the sending domain is verified. A key
 * limited to sending can't list domains (401 restricted_api_key), which still means it works.
 */
export async function resendStatus(fetcher: typeof fetch): Promise<Omit<HealthCheck, "id" | "label" | "latencyMs">> {
  const from = process.env.RESEND_FROM_EMAIL ?? "";
  const domain = from.includes("@") ? from.split("@").pop()!.replace(/>$/, "").toLowerCase() : "";
  if (!domain) return { status: "warn", detail: "RESEND_FROM_EMAIL is not set." };
  const response = await fetcher("https://api.resend.com/domains", { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as { name?: string } | null;
    if (body?.name === "restricted_api_key") return { status: "ok", detail: "The key works (it is limited to sending, so the domain was not checked)." };
  }
  if (!response.ok) return statusFromResponse(response.status, "Resend");
  const list = (await response.json().catch(() => null)) as { data?: Array<{ name?: string; status?: string }> } | null;
  const match = list?.data?.find((d) => d.name?.toLowerCase() === domain);
  if (!match) return { status: "error", detail: `The sending domain ${domain} is not in this Resend account.` };
  if (match.status !== "verified") return { status: "warn", detail: `The sending domain ${domain} is ${match.status ?? "not verified"} in Resend.` };
  return { status: "ok", detail: `Resend answered; ${domain} is verified.` };
}

export async function runHealthChecks(fetcher: typeof fetch = fetch): Promise<HealthCheck[]> {
  const llmBase = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const embedding = getEmbeddingConfig();
  const stripe = getStripeConfig();
  const recall = describeRecallConfig();
  const workos = describeWorkosConfig();
  const push = getBrowserPushConfiguration();

  const checks: Array<[string, string, () => Promise<Omit<HealthCheck, "id" | "label">>]> = [
    ["database", "Database", () => timed(async () => {
      const db = await getDb();
      if (!db) return { status: "error", detail: "No database connection is configured." };
      await db.execute(sql`select 1`);
      return { status: "ok", detail: "Connected." };
    })],
    ["storage", "Storage", () => timed(async () => storageStatus(isVercelBlobStorageConfigured() ? await getBlobUsage() : { configured: false, totalBytes: 0, limitBytes: 0 }))],
    ["blob-transfer", "Storage transfer", () => timed(async () => {
      if (!isVercelBlobStorageConfigured()) return { status: "off", detail: "Vercel Blob is not configured." };
      const report = await getTransferReport();
      return transferStatus(report, report.limitBytes);
    })],
    ["assemblyai", "Transcription (AssemblyAI)", process.env.ASSEMBLYAI_API_KEY ? () => timed(async () => {
      const response = await fetcher("https://api.assemblyai.com/v2/transcript?limit=1", { headers: { authorization: process.env.ASSEMBLYAI_API_KEY! } });
      return statusFromResponse(response.status, "AssemblyAI");
    }) : off("ASSEMBLYAI_API_KEY is not set, so transcription fails.")],
    ["llm", "AI model", process.env.OPENAI_API_KEY ? () => timed(async () => {
      const response = await fetcher(`${llmBase}/models`, { headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
      const result = statusFromResponse(response.status, "The model provider");
      return result.status === "ok" ? { ...result, detail: `${result.detail} Model: ${process.env.OPENAI_MODEL || "default"}.` } : result;
    }) : off("OPENAI_API_KEY is not set, so notes, flashcards and other AI tools fail.")],
    ["embeddings", "Smart search (embeddings)", embedding ? () => timed(async () => {
      const response = await fetcher(`${embedding.baseUrl.replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${embedding.apiKey}` } });
      const result = statusFromResponse(response.status, "The embeddings provider");
      return result.status === "ok" ? { ...result, detail: `${result.detail} Model: ${embedding.model}.` } : result;
    }) : off("OPENAI_EMBEDDING_MODEL is not set; Ask uses keyword search.")],
    ["stripe", "Billing (Stripe)", stripe ? () => timed(async () => {
      await stripeRequest("GET", "/balance", {}, { config: stripe });
      return { status: "ok", detail: `Stripe answered (${stripe.secretKey.startsWith("sk_live_") || stripe.secretKey.startsWith("rk_live_") ? "live" : "test"} mode${stripe.yearlyPrices ? ", yearly prices set" : ""}).` };
    }) : off("Stripe is not fully configured; paid plans show Coming soon.")],
    ["resend", "Email (Resend)", process.env.RESEND_API_KEY ? () => timed(async () => resendStatus(fetcher)) : off("RESEND_API_KEY is not set, so password resets and confirmations are not emailed.")],
    ["recall", "Meeting note-taker (Recall.ai)", recall.configured ? () => timed(async () => {
      const config = getRecallConfig()!;
      const response = await fetcher(`${config.apiBase}/bot/?page_size=1`, { headers: { authorization: `Token ${config.apiKey}`, accept: "application/json" } });
      const result = statusFromResponse(response.status, "Recall.ai");
      return result.status === "ok" ? { ...result, detail: `${result.detail} Region ${config.region}.` } : result;
    }) : off("Recall.ai is not configured; the note-taker is off.")],
    ["workos", "Single sign-on (WorkOS)", workos.configured ? () => timed(async () => {
      const config = getWorkosConfig()!;
      const response = await fetcher(`${config.apiBase}/organizations?limit=1`, { headers: { authorization: `Bearer ${config.apiKey}` } });
      return statusFromResponse(response.status, "WorkOS");
    }) : off("WorkOS is not configured; SAML sign-in is off.")],
    ["push", "Browser push", push.supported ? async () => ({ status: "ok", detail: "VAPID keys are set.", latencyMs: null }) : off("VAPID keys are not set; reminders stay in the app.")],
    ["cron", "Daily run (cron)", () => timed(async () => {
      const setting = await getAppSetting(CRON_LAST_RUN_KEY).catch(() => null);
      const at = setting ? new Date(setting.value) : null;
      return cronStatus(at && !Number.isNaN(at.getTime()) ? at : null);
    })],
  ];

  return Promise.all(checks.map(async ([id, label, run]) => ({ id, label, ...(await run()) })));
}
