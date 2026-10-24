/**
 * Monthly Vercel Blob transfer accounting.
 *
 * The free plan allows 10 GB a month of Blob Data Transfer (bytes the function
 * fetches from Blob) and Fast Origin Transfer (bytes it sends to browsers); a
 * store with 9 MB in it still blew through that because every playback request
 * is proxied. This keeps a best-effort counter in `appSettings`
 * (`blob_transfer:<YYYY-MM>`, JSON {served, fetched}), batched so playback does
 * not write on every request, with every failure ignored: counting must never
 * break playback. Serverless instances can be frozen with bytes still pending,
 * so the figure is a floor, not an invoice.
 */
export const TRANSFER_KEY_PREFIX = "blob_transfer:";
export const DEFAULT_TRANSFER_LIMIT_BYTES = 10 * 1024 ** 3;
const FLUSH_BYTES = 2 * 1024 * 1024;
const FLUSH_INTERVAL_MS = 30_000;
const SOFT_CAP_CACHE_MS = 60_000;

export type TransferTotals = { served: number; fetched: number };
export type TransferLevel = "ok" | "warn" | "error";

export function transferPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function transferLimitBytes(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.BLOB_TRANSFER_LIMIT_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TRANSFER_LIMIT_BYTES;
}

/** BLOB_TRANSFER_SOFT_CAP: a fraction of the limit (0 < x <= 1) or an absolute byte count. Default 95%. */
export function transferSoftCapBytes(env: NodeJS.ProcessEnv = process.env): number {
  const limit = transferLimitBytes(env);
  const value = Number(env.BLOB_TRANSFER_SOFT_CAP);
  if (!Number.isFinite(value) || value <= 0) return Math.floor(limit * 0.95);
  return value <= 1 ? Math.floor(limit * value) : Math.floor(value);
}

/** The larger of the two directions is what Vercel bills against its allowance. */
export function transferUsedBytes(totals: TransferTotals): number {
  return Math.max(totals.served, totals.fetched);
}

export function transferLevel(totals: TransferTotals, limit = transferLimitBytes()): TransferLevel {
  const share = limit > 0 ? transferUsedBytes(totals) / limit : 0;
  if (share >= 0.95) return "error";
  if (share >= 0.8) return "warn";
  return "ok";
}

export function parseTotals(raw: string | null | undefined): TransferTotals {
  try {
    const data = JSON.parse(raw ?? "") as Partial<TransferTotals>;
    const served = Number(data.served);
    const fetched = Number(data.fetched);
    return { served: Number.isFinite(served) && served > 0 ? served : 0, fetched: Number.isFinite(fetched) && fetched > 0 ? fetched : 0 };
  } catch {
    return { served: 0, fetched: 0 };
  }
}

let pending: TransferTotals = { served: 0, fetched: 0 };
let lastFlush = Date.now();
let softCapCache: { at: number; used: number } | null = null;

async function readStored(period = transferPeriod()): Promise<TransferTotals> {
  const { getAppSetting } = await import("./db");
  const row = await getAppSetting(TRANSFER_KEY_PREFIX + period);
  return parseTotals(row?.value);
}

export async function flushTransfer(): Promise<void> {
  if (pending.served === 0 && pending.fetched === 0) return;
  // Swap first so concurrent flushes never send the same bytes twice.
  const batch = pending;
  pending = { served: 0, fetched: 0 };
  lastFlush = Date.now();
  try {
    const { incrementTransferCounter } = await import("./db");
    // One atomic INSERT ... ON DUPLICATE KEY UPDATE: no read-then-write race between instances.
    await incrementTransferCounter(TRANSFER_KEY_PREFIX + transferPeriod(), batch.served, batch.fetched);
  } catch {
    // Keep the bytes for the next attempt rather than dropping them.
    pending = { served: pending.served + batch.served, fetched: pending.fetched + batch.fetched };
  }
}

/**
 * Adds bytes sent to browsers and bytes fetched from Blob. Never throws and
 * never waits for the database. `flush: true` (used when a response ends)
 * also starts a background write, so a short-lived instance loses less.
 */
export function recordTransfer(bytes: Partial<TransferTotals>, options: { flush?: boolean } = {}): void {
  try {
    pending.served += Math.max(0, bytes.served ?? 0);
    pending.fetched += Math.max(0, bytes.fetched ?? 0);
    if (options.flush || pending.served + pending.fetched >= FLUSH_BYTES || Date.now() - lastFlush >= FLUSH_INTERVAL_MS) void flushTransfer().catch(() => undefined);
  } catch {
    // ignored on purpose
  }
}

/** This month's totals, including bytes not yet written. Database errors read as zero. */
export async function getTransferTotals(): Promise<TransferTotals> {
  let stored: TransferTotals = { served: 0, fetched: 0 };
  try {
    stored = await readStored();
  } catch {
    // tolerate a missing database or table
  }
  return { served: stored.served + pending.served, fetched: stored.fetched + pending.fetched };
}

export async function getTransferReport() {
  const totals = await getTransferTotals();
  const limitBytes = transferLimitBytes();
  const softCapBytes = transferSoftCapBytes();
  return { period: transferPeriod(), ...totals, limitBytes, softCapBytes, level: transferLevel(totals, limitBytes), softCapReached: transferUsedBytes(totals) >= softCapBytes };
}

/** True when this month's transfer reached the soft cap. Cached for a minute; fails open. */
export async function isTransferSoftCapReached(now = Date.now()): Promise<boolean> {
  return (await cachedUsedBytes(now)) >= transferSoftCapBytes();
}

/** True at the hard limit, where Vercel would suspend the store; even owners are refused then. */
export async function isTransferLimitReached(now = Date.now()): Promise<boolean> {
  return (await cachedUsedBytes(now)) >= transferLimitBytes();
}

async function cachedUsedBytes(now: number): Promise<number> {
  if (!softCapCache || now - softCapCache.at > SOFT_CAP_CACHE_MS) {
    softCapCache = { at: now, used: transferUsedBytes(await getTransferTotals()) };
  }
  return softCapCache.used + Math.max(pending.served, pending.fetched);
}

export const TRANSFER_PAUSED_MESSAGE =
  "Playback for shared recordings and link imports is paused until next month because this app's monthly storage transfer allowance is almost used up. The owner can still play their own recordings.";

/** Throws a plain, user-facing error for work that adds large transfers while the soft cap is reached. */
export async function assertTransferHeadroomForImport(): Promise<void> {
  if (await isTransferSoftCapReached()) throw new Error(TRANSFER_PAUSED_MESSAGE);
}

export function resetTransferStateForTests() {
  pending = { served: 0, fetched: 0 };
  lastFlush = Date.now();
  softCapCache = null;
}
