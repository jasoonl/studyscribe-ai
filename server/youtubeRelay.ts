/**
 * Client for the self-hosted YouTube relay (scripts/youtube-relay/relay.mjs).
 * YouTube blocks datacenter networks, so when YOUTUBE_RELAY_SECRET is set every
 * YouTube request is sent to a relay on the owner's own computer, reached via a
 * Cloudflare quick tunnel whose address the relay registers here.
 *
 * Trust model: requests and responses are both HMAC-signed with the shared
 * secret (with timestamps and nonces against replay), so a recycled or spoofed
 * tunnel hostname can neither use the relay nor feed us fake audio. The tunnel
 * address is stored server-side only and never returned to any client.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import express, { type Express, type Request, type Response as ExpressResponse } from "express";
import rateLimit from "express-rate-limit";
import { getAppSetting, setAppSetting } from "./db";

const SETTING_KEY = "youtubeRelay";
const MAX_SKEW_MS = 60_000;
const ONLINE_WINDOW_MS = 12 * 60_000;
const ENDPOINT_CACHE_MS = 20_000;
const TUNNEL_URL = /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/;

export class RelayUnavailableError extends Error {}

export function isYouTubeRelayConfigured() {
  return Boolean(process.env.YOUTUBE_RELAY_SECRET);
}

function secret(): string {
  const value = process.env.YOUTUBE_RELAY_SECRET;
  if (!value || value.length < 40) throw new RelayUnavailableError("The YouTube relay secret is missing or too short.");
  return value;
}

// ---- signing (mirrors scripts/youtube-relay/relay.mjs) -------------------------

export function sha256Hex(data: Buffer | Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

export function sign(key: string, purpose: string, ts: number, nonce: string, body: Buffer | Uint8Array | string) {
  return createHmac("sha256", key).update(`${purpose}\n${ts}\n${nonce}\n${sha256Hex(body)}`).digest("hex");
}

function safeEqualHex(a: unknown, b: string) {
  if (typeof a !== "string" || !/^[0-9a-f]{64}$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function signedHeaders(key: string, purpose: string, body: Buffer) {
  const ts = Date.now();
  const nonce = randomBytes(16).toString("hex");
  return { "x-relay-ts": String(ts), "x-relay-nonce": nonce, "x-relay-sig": sign(key, purpose, ts, nonce, body) };
}

export function verifySignature(key: string, purpose: string, get: (name: string) => string | null | undefined, body: Buffer | Uint8Array, now = Date.now()) {
  const ts = Number(get("x-relay-ts"));
  const nonce = get("x-relay-nonce");
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return null;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) return null;
  return safeEqualHex(get("x-relay-sig"), sign(key, purpose, ts, nonce, body)) ? nonce : null;
}

const seenRegisterNonces = new Map<string, number>();
function claimNonce(nonce: string, now = Date.now()) {
  for (const [key, expiry] of Array.from(seenRegisterNonces)) if (expiry < now) seenRegisterNonces.delete(key);
  if (seenRegisterNonces.has(nonce)) return false;
  seenRegisterNonces.set(nonce, now + 2 * MAX_SKEW_MS);
  return true;
}

// ---- talking to the relay ----------------------------------------------------------

type RelayJob = { method: "GET" | "POST" | "PING"; url?: string; headers?: Record<string, string>; body?: string };

async function callRelay(endpoint: string, job: RelayJob, signal?: AbortSignal | null): Promise<Response> {
  const key = secret();
  const body = Buffer.from(JSON.stringify(job));
  const headers = signedHeaders(key, "relay-request", body);
  const response = await fetch(`${endpoint}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    signal: signal ?? AbortSignal.timeout(40_000),
    redirect: "error",
  });
  if (response.status !== 200) throw new RelayUnavailableError("The YouTube relay on your computer did not accept the request. Make sure it is running and its secret matches.");

  const payload = Buffer.from(await response.arrayBuffer());
  const status = Number(response.headers.get("x-relay-status"));
  const purpose = `relay-response\n${headers["x-relay-nonce"]}\n${status}`;
  if (!Number.isInteger(status) || !verifySignature(key, purpose, (name) => response.headers.get(name), payload)) {
    throw new RelayUnavailableError("The YouTube relay's reply could not be verified, so it was discarded.");
  }
  return new Response(status === 204 || status === 304 ? null : payload, {
    status: status >= 200 && status <= 599 ? status : 502,
    headers: { "content-type": response.headers.get("x-relay-type") ?? "application/octet-stream" },
  });
}

let endpointCache: { url: string | null; at: number } | null = null;

async function readEndpoint(): Promise<{ url: string; lastSeen: Date } | null> {
  const setting = await getAppSetting(SETTING_KEY);
  if (!setting) return null;
  try {
    const url = JSON.parse(setting.value)?.url;
    return typeof url === "string" && TUNNEL_URL.test(url) ? { url, lastSeen: setting.updatedAt } : null;
  } catch {
    return null;
  }
}

async function onlineEndpoint(): Promise<string | null> {
  if (endpointCache && Date.now() - endpointCache.at < ENDPOINT_CACHE_MS) return endpointCache.url;
  const current = await readEndpoint();
  const url = current && Date.now() - current.lastSeen.getTime() < ONLINE_WINDOW_MS ? current.url : null;
  endpointCache = { url, at: Date.now() };
  return url;
}

/** fetch() replacement that routes a YouTube request through the relay. */
export async function relayFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const endpoint = await onlineEndpoint();
  if (!endpoint) {
    throw new RelayUnavailableError("The YouTube relay on your computer is offline. Start it (npm run relay) and try again, or upload the audio file instead.");
  }
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const method = (init?.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
  return callRelay(endpoint, { method, url: String(input), headers, body: typeof init?.body === "string" ? init.body : undefined }, init?.signal);
}

/** Admin diagnostics: whether the relay is configured and recently checked in. Never includes its address. */
export async function youtubeRelayStatus() {
  if (!isYouTubeRelayConfigured()) return { configured: false, online: false, lastSeenAt: null as string | null };
  const current = await readEndpoint().catch(() => null);
  return {
    configured: true,
    online: Boolean(current && Date.now() - current.lastSeen.getTime() < ONLINE_WINDOW_MS),
    lastSeenAt: current ? current.lastSeen.toISOString() : null,
  };
}

// ---- registration endpoint ---------------------------------------------------------

const registerLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: false, legacyHeaders: false });

async function handleRegister(req: Request, res: ExpressResponse) {
  // Unconfigured, unsigned, stale or replayed requests all get the same bare 404.
  const reject = () => res.status(404).end();
  if (!isYouTubeRelayConfigured()) return reject();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const key = secret();
  const nonce = verifySignature(key, "relay-register", (name) => req.get(name), raw);
  if (!nonce || !claimNonce(nonce)) return reject();

  let url: unknown;
  try {
    url = JSON.parse(raw.toString("utf8"))?.url;
  } catch {
    return res.status(400).end();
  }
  if (typeof url !== "string" || !TUNNEL_URL.test(url)) return res.status(400).end();

  // Only store an address that proves it is our relay by answering a signed ping.
  try {
    const pong = await callRelay(url, { method: "PING" }, AbortSignal.timeout(15_000));
    if (pong.status !== 200 || (await pong.text()) !== "pong") return res.status(502).end();
  } catch {
    return res.status(502).end();
  }

  await setAppSetting(SETTING_KEY, JSON.stringify({ url }));
  endpointCache = null;
  res.set("cache-control", "no-store").status(204).end();
}

/** Must be registered before the global JSON body parser: the signature covers the raw bytes. */
export function registerYouTubeRelayRoutes(app: Express) {
  app.post("/api/youtube-relay/register", registerLimiter, express.raw({ type: () => true, limit: "2kb" }), (req, res) => {
    handleRegister(req, res).catch(() => res.status(500).end());
  });
}
