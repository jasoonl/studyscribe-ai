#!/usr/bin/env node
// StudyScribe YouTube relay: runs on your own computer so YouTube sees a home
// connection instead of Vercel's datacenter. Reached only through an outbound
// Cloudflare quick tunnel, so no router port is opened and the home IP is never
// published. Every request must carry an HMAC signed with a secret shared only
// with the StudyScribe server, and only YouTube's own endpoints can be fetched.
//
//   node scripts/youtube-relay/relay.mjs init    create the secret (copied to clipboard)
//   node scripts/youtube-relay/relay.mjs         start relay + tunnel, register with the app

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_SKEW_MS = 60_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_CONCURRENT = 6;
const MAX_PER_MINUTE = 300;
const FORWARDED_HEADERS = new Set(["user-agent", "content-type", "x-youtube-client-name", "x-youtube-client-version", "range", "accept-language"]);

// ---- signing (mirrored in server/youtubeRelay.ts) ----------------------------

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sign(secret, purpose, ts, nonce, body) {
  return createHmac("sha256", secret).update(`${purpose}\n${ts}\n${nonce}\n${sha256Hex(body)}`).digest("hex");
}

export function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function createNonceCache(limit = 10_000) {
  const seen = new Map();
  return {
    /** true the first time a nonce is seen inside the skew window, false on replay */
    claim(nonce, now = Date.now()) {
      for (const [key, expiry] of seen) {
        if (expiry > now && seen.size < limit) break;
        seen.delete(key);
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, now + 2 * MAX_SKEW_MS);
      return true;
    },
  };
}

export function verifyRequest(secret, headers, body, nonces, now = Date.now()) {
  const ts = Number(headers["x-relay-ts"]);
  const nonce = headers["x-relay-nonce"];
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return false;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) return false;
  if (!safeEqualHex(headers["x-relay-sig"], sign(secret, "relay-request", ts, nonce, body))) return false;
  return nonces.claim(nonce, now);
}

// ---- destination allowlist -----------------------------------------------------

export function isAllowedTarget(raw, { redirect = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.googlevideo\.com$/.test(host)) return url.pathname === "/videoplayback";
  if (redirect) return false;
  return host === "www.youtube.com" && url.pathname === "/youtubei/v1/player";
}

const privateRanges = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]]) {
  privateRanges.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) {
  privateRanges.addSubnet(net, bits, "ipv6");
}

export function isPublicAddress(address) {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by the IPv4 address it carries.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return false;
  return !privateRanges.check(address, family === 4 ? "ipv4" : "ipv6");
}

// Resolves and pins the address the socket connects to, so a DNS answer can't
// swap in a private address between the check and the connection.
function publicOnlyLookup(hostname, options, callback) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const usable = addresses.filter((entry) => isPublicAddress(entry.address));
    if (usable.length === 0) return callback(new Error("blocked destination"));
    if (options?.all) return callback(null, usable);
    callback(null, usable[0].address, usable[0].family);
  });
}

// ---- upstream fetch --------------------------------------------------------------

function fetchUpstream(target, method, headers, body, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(target, { method, headers, lookup: publicOnlyLookup, timeout: UPSTREAM_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, target).toString();
        if (redirectsLeft <= 0 || !isAllowedTarget(next, { redirect: true })) return reject(new Error("blocked redirect"));
        const { "content-type": _drop, ...rest } = headers;
        return fetchUpstream(next, "GET", rest, undefined, redirectsLeft - 1).then(resolve, reject);
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        res.destroy();
        return reject(new Error("response too large"));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          res.destroy(new Error("response too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, contentType: String(res.headers["content-type"] ?? "application/octet-stream"), body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("upstream timeout")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// ---- HTTP server -----------------------------------------------------------------

export function createRelayServer(secret, { log = () => {} } = {}) {
  const nonces = createNonceCache();
  let active = 0;
  let windowStart = Date.now();
  let windowCount = 0;

  const notFound = (res) => {
    res.writeHead(404, { "content-length": "0", connection: "close" });
    res.end();
  };

  const reply = (res, reqNonce, status, contentType, body) => {
    const ts = Date.now();
    const nonce = randomBytes(16).toString("hex");
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
      "cache-control": "no-store",
      "x-relay-status": String(status),
      "x-relay-type": contentType.slice(0, 200),
      "x-relay-ts": String(ts),
      "x-relay-nonce": nonce,
      "x-relay-sig": sign(secret, `relay-response\n${reqNonce}\n${status}`, ts, nonce, body),
    });
    res.end(body);
  };

  return createServer({ requestTimeout: 45_000, headersTimeout: 10_000 }, (req, res) => {
    if (req.method !== "POST" || req.url !== "/relay") return notFound(res);
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        aborted = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks);
      if (!verifyRequest(secret, req.headers, raw, nonces)) return notFound(res);
      const reqNonce = req.headers["x-relay-nonce"];

      const now = Date.now();
      if (now - windowStart > 60_000) {
        windowStart = now;
        windowCount = 0;
      }
      if (active >= MAX_CONCURRENT || ++windowCount > MAX_PER_MINUTE) return reply(res, reqNonce, 429, "text/plain", Buffer.from("busy"));

      let job;
      try {
        job = JSON.parse(raw.toString("utf8"));
      } catch {
        return reply(res, reqNonce, 400, "text/plain", Buffer.from("bad request"));
      }
      if (job?.method === "PING") return reply(res, reqNonce, 200, "text/plain", Buffer.from("pong"));
      if ((job?.method !== "GET" && job?.method !== "POST") || !isAllowedTarget(job.url)) {
        log("refused a disallowed destination");
        return reply(res, reqNonce, 403, "text/plain", Buffer.from("destination not allowed"));
      }

      const headers = {};
      for (const [name, value] of Object.entries(job.headers ?? {})) {
        const key = name.toLowerCase();
        if (FORWARDED_HEADERS.has(key) && typeof value === "string" && value.length < 512 && !/[\r\n]/.test(value)) headers[key] = value;
      }
      const body = job.method === "POST" && typeof job.body === "string" ? Buffer.from(job.body, "utf8") : undefined;
      if (body) headers["content-length"] = String(body.length);

      active++;
      try {
        const upstream = await fetchUpstream(job.url, job.method, headers, body);
        log(`${job.method} ${new URL(job.url).hostname.endsWith("googlevideo.com") ? "audio chunk" : "player"} -> ${upstream.status}`);
        reply(res, reqNonce, upstream.status, upstream.contentType, upstream.body);
      } catch {
        log("upstream request failed");
        reply(res, reqNonce, 502, "text/plain", Buffer.from("upstream failed"));
      } finally {
        active--;
      }
    });
  });
}

// ---- CLI -------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".studyscribe-relay");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_APP_URL = "https://studyscribe-ai.vercel.app";

function readConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  if (typeof config.secret !== "string" || config.secret.length < 40) throw new Error(`Invalid secret in ${CONFIG_FILE}`);
  return { appUrl: DEFAULT_APP_URL, ...config };
}

function init() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  chmodSync(CONFIG_DIR, 0o700);
  let config = readConfig();
  if (!config) {
    config = { secret: randomBytes(32).toString("base64url"), appUrl: DEFAULT_APP_URL };
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
  chmodSync(CONFIG_FILE, 0o600);
  try {
    execFileSync("pbcopy", { input: config.secret });
    console.log("The relay secret is on your clipboard (it is not printed here).");
  } catch {
    console.log(`Copy the "secret" value from ${CONFIG_FILE}.`);
  }
  console.log("In Vercel: Project → Settings → Environment Variables → add YOUTUBE_RELAY_SECRET (Production), paste, save, then redeploy.");
}

async function register(config, tunnelUrl) {
  const body = Buffer.from(JSON.stringify({ url: tunnelUrl }));
  const ts = Date.now();
  const nonce = randomBytes(16).toString("hex");
  const response = await fetch(`${config.appUrl}/api/youtube-relay/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-ts": String(ts), "x-relay-nonce": nonce, "x-relay-sig": sign(config.secret, "relay-register", ts, nonce, body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  return response.status;
}

async function start() {
  const config = readConfig();
  if (!config) {
    console.error("No secret yet. Run: node scripts/youtube-relay/relay.mjs init");
    process.exit(1);
  }
  const stamp = () => new Date().toLocaleTimeString();
  const server = createRelayServer(config.secret, { log: (line) => console.log(`[${stamp()}] ${line}`) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "ignore", "pipe"] });
  let tunnelUrl = null;
  let heartbeat = null;

  const announce = async () => {
    try {
      const status = await register(config, tunnelUrl);
      if (status === 204) console.log(`[${stamp()}] Connected to StudyScribe. YouTube links will import through this computer.`);
      else if (status === 404) console.log(`[${stamp()}] StudyScribe rejected the relay. Check YOUTUBE_RELAY_SECRET in Vercel matches (run init to copy it again) and that the app is redeployed.`);
      else console.log(`[${stamp()}] StudyScribe could not verify the relay yet (status ${status}); retrying shortly.`);
      return status === 204;
    } catch {
      console.log(`[${stamp()}] Could not reach StudyScribe; retrying shortly.`);
      return false;
    }
  };

  tunnel.stderr.setEncoding("utf8");
  tunnel.stderr.on("data", async (text) => {
    const match = !tunnelUrl && text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!match) return;
    tunnelUrl = match[0];
    console.log(`[${stamp()}] Secure tunnel is up.`);
    // Quick tunnels take a few seconds to become reachable from outside.
    for (let tries = 0; tries < 6 && !(await announce()); tries++) await new Promise((r) => setTimeout(r, 5_000));
    heartbeat = setInterval(announce, 5 * 60_000);
  });
  tunnel.on("error", () => {
    console.error("cloudflared is not installed. Run: brew install cloudflared");
    process.exit(1);
  });
  tunnel.on("exit", (code) => {
    console.error(`[${stamp()}] Tunnel stopped (${code}). Relay shutting down.`);
    process.exit(1);
  });

  const shutdown = () => {
    clearInterval(heartbeat);
    tunnel.kill();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log(`[${stamp()}] Relay listening on this computer only. Starting secure tunnel…`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "init") init();
  else start();
}
