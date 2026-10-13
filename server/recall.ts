import { createHmac, timingSafeEqual } from "crypto";

/**
 * A small client for Recall.ai's meeting bot API (A4), over REST with no SDK.
 *
 * Configured only when RECALL_API_KEY, RECALL_REGION and
 * RECALL_WEBHOOK_SECRET are all set; otherwise "Send a note-taker" explains
 * it is not set up. RECALL_API_BASE points at a local mock outside
 * production only, so the key can never be sent anywhere else in production.
 *
 * Webhooks are signed the Svix / Standard Webhooks way, which Recall uses:
 * HMAC-SHA256 of `${id}.${timestamp}.${rawBody}` with the base64 secret after
 * its `whsec_` prefix, sent as `v1,<base64>` (several, space-separated) in
 * `webhook-signature` (or `svix-signature`), with a five-minute window.
 */

const HTTP_TIMEOUT_MS = 15_000;
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const RECALL_REGIONS = ["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"] as const;

export type RecallConfig = { apiKey: string; region: string; webhookSecret: string; apiBase: string };

export function getRecallConfig(env: NodeJS.ProcessEnv = process.env): RecallConfig | null {
  const apiKey = env.RECALL_API_KEY?.trim();
  const region = env.RECALL_REGION?.trim();
  const webhookSecret = env.RECALL_WEBHOOK_SECRET?.trim();
  if (!apiKey || !region || !webhookSecret) return null;
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) return null;
  const override = env.NODE_ENV !== "production" ? env.RECALL_API_BASE?.trim().replace(/\/$/, "") : undefined;
  return { apiKey, region, webhookSecret, apiBase: override || `https://${region}.recall.ai/api/v1` };
}

export function isRecallConfigured(env: NodeJS.ProcessEnv = process.env) {
  return getRecallConfig(env) !== null;
}

/** For the Admin page: which values are present, never the values. */
export function describeRecallConfig(env: NodeJS.ProcessEnv = process.env) {
  const has = (name: string) => Boolean(env[name]?.trim());
  const origin = (env.PUBLIC_APP_URL || env.APP_URL || "").replace(/\/$/, "");
  return {
    configured: isRecallConfigured(env),
    apiKey: has("RECALL_API_KEY"),
    region: env.RECALL_REGION?.trim() || null,
    regionValid: !env.RECALL_REGION?.trim() || /^[a-z]{2}-[a-z]+-\d$/.test(env.RECALL_REGION.trim()),
    webhookSecret: has("RECALL_WEBHOOK_SECRET"),
    webhookUrl: origin ? `${origin}/api/webhooks/recall` : null,
    usingTestApi: env.NODE_ENV !== "production" && has("RECALL_API_BASE"),
  };
}

export type MeetingPlatform = "zoom" | "google_meet" | "teams";

export const PLATFORM_LABELS: Record<MeetingPlatform, string> = { zoom: "Zoom", google_meet: "Google Meet", teams: "Microsoft Teams" };

/** Which supported meeting service a link is for, or null. Only https links to the services' own hosts count. */
export function meetingPlatform(link: string): MeetingPlatform | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if ((under("zoom.us") || under("zoom.com") || under("zoomgov.com")) && /\/(j|w|my|s)\//.test(url.pathname + "/")) return "zoom";
  if (host === "meet.google.com" && /^\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}/i.test(url.pathname)) return "google_meet";
  if ((host === "teams.microsoft.com" || host === "teams.live.com") && url.pathname.length > 1) return "teams";
  return null;
}

/** The bot's name in the participant list: it always says it is recording. */
export function noteTakerName(personName: string | null | undefined) {
  const first = (personName ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9\u00C0-\u024F' -]/g, "").slice(0, 30);
  return first ? `StudyScribe note-taker (recording for ${first})` : "StudyScribe note-taker (recording)";
}

/** Posted in the meeting chat when the bot joins, so everyone sees why it is there. */
export function joinMessage(personName: string | null | undefined) {
  const who = (personName ?? "").trim() || "Someone in this meeting";
  return `Hi, I'm a StudyScribe note-taker. ${who} asked me to record this meeting to make notes. If you don't want to be recorded, say so or remove me from the call.`;
}

export function buildCreateBotBody(input: { meetingUrl: string; botName: string; personName: string | null; joinAt: Date | null; botRowId: number; userId: number }) {
  return {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    ...(input.joinAt ? { join_at: input.joinAt.toISOString() } : {}),
    // Audio only: StudyScribe transcribes it itself, and audio keeps storage small.
    recording_config: { audio_mixed_mp3: {} },
    chat: { on_bot_join: { send_to: "everyone", message: joinMessage(input.personName) } },
    automatic_leave: { waiting_room_timeout: 600, noone_joined_timeout: 600 },
    metadata: { studyscribe_bot: String(input.botRowId), studyscribe_user: String(input.userId) },
  };
}

export class RecallApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function recallRequest<T = any>(config: RecallConfig, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.apiBase}${path}`, {
    method,
    headers: { authorization: `Token ${config.apiKey}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
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
    const detail = typeof json?.detail === "string" ? json.detail : Array.isArray(json?.meeting_url) ? json.meeting_url.join(" ") : `Recall returned ${response.status}`;
    throw new RecallApiError(detail, response.status);
  }
  return json as T;
}

/** Recall's status codes, mapped to the few states StudyScribe shows. */
export function statusFromRecallCode(code: string | null | undefined): { status: string; detail: string | null } | null {
  switch (code) {
    case "ready":
      return { status: "scheduled", detail: null };
    case "joining_call":
      return { status: "joining", detail: "Joining the call" };
    case "in_waiting_room":
      return { status: "waiting_room", detail: "Waiting to be let in" };
    case "in_call_not_recording":
    case "recording_permission_allowed":
      return { status: "in_call", detail: "In the call" };
    case "in_call_recording":
      return { status: "recording", detail: "Recording" };
    case "recording_permission_denied":
      return { status: "failed", detail: "The host did not allow recording" };
    case "call_ended":
      return { status: "ended", detail: "The call ended" };
    case "done":
      return { status: "done", detail: "Getting the recording" };
    case "fatal":
      return { status: "failed", detail: "The note-taker could not join or record" };
    default:
      return null;
  }
}

const ORDER = ["scheduled", "joining", "waiting_room", "in_call", "recording", "ended", "done", "importing", "imported"];
const FINAL = new Set(["imported", "failed", "cancelled"]);

/**
 * Whether a reported status should replace the stored one. Webhooks can
 * arrive out of order or twice, so a status never moves backwards, and a
 * finished bot (imported, failed, cancelled) never changes again; "importing"
 * belongs to the import itself, so only a webhook's "done" or later counts.
 */
export function shouldApplyStatus(current: string, next: string) {
  if (current === next || FINAL.has(current)) return false;
  if (next === "failed" || next === "cancelled") return current !== "importing";
  const from = ORDER.indexOf(current);
  const to = ORDER.indexOf(next);
  return to > from && current !== "importing";
}

export function isActiveBotStatus(status: string) {
  return !FINAL.has(status);
}

/** The newest status change in a bot object from GET /bot/:id. */
export function latestStatusCode(bot: any): string | null {
  const changes = Array.isArray(bot?.status_changes) ? bot.status_changes : [];
  const last = changes[changes.length - 1];
  return typeof last?.code === "string" ? last.code : typeof bot?.status?.code === "string" ? bot.status.code : null;
}

/** Where to download the meeting's audio from a finished bot, newest API shape first. */
export function mediaDownloadUrl(bot: any): string | null {
  const recordings = Array.isArray(bot?.recordings) ? bot.recordings : [];
  for (const recording of recordings) {
    const shortcuts = recording?.media_shortcuts ?? {};
    for (const key of ["audio_mixed", "video_mixed"]) {
      const url = shortcuts?.[key]?.data?.download_url;
      if (typeof url === "string" && url) return url;
    }
  }
  return typeof bot?.video_url === "string" && bot.video_url ? bot.video_url : null;
}

/** Recall serves media from its own storage on AWS; anything else is refused (plus the local mock outside production). */
export function isAllowedMediaUrl(link: string, config: RecallConfig, env: NodeJS.ProcessEnv = process.env) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (env.NODE_ENV !== "production" && env.RECALL_API_BASE) {
    try {
      if (url.host === new URL(config.apiBase).host) return true;
    } catch {
      // Fall through to the production rule.
    }
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host.endsWith(".recall.ai") || host.endsWith(".amazonaws.com"));
}

// ------------------------------------------------------------- signatures

function secretBytes(secret: string) {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(raw, "base64");
}

export function signRecallPayload(id: string, timestamp: number, body: string, secret: string) {
  return `v1,${createHmac("sha256", secretBytes(secret)).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64")}`;
}

export type RecallSignatureCheck = { ok: true } | { ok: false; reason: "missing" | "expired" | "mismatch" };

export function verifyRecallSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): RecallSignatureCheck {
  const header = (name: string) => {
    const value = headers[`webhook-${name}`] ?? headers[`svix-${name}`];
    return Array.isArray(value) ? value[0] : value;
  };
  const id = header("id");
  const timestamp = header("timestamp");
  const signatures = header("signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return { ok: false, reason: "missing" };
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "expired" };
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = Buffer.from(signRecallPayload(id, Number(timestamp), body, secret).slice(3), "base64");
  for (const part of signatures.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}

/** The bot id and status code from a webhook body (`bot.*` status events). */
export function parseRecallEvent(body: any): { botId: string; code: string; at: number } | null {
  const event = typeof body?.event === "string" ? body.event : "";
  if (!event.startsWith("bot.")) return null;
  const botId = body?.data?.bot?.id ?? body?.data?.bot_id;
  if (typeof botId !== "string" || !botId) return null;
  const inner = body?.data?.data ?? body?.data?.status ?? {};
  const code = typeof inner?.code === "string" ? inner.code : event === "bot.status_change" ? null : event.slice(4);
  if (!code) return null;
  const updated = Date.parse(inner?.updated_at ?? inner?.created_at ?? "");
  return { botId, code, at: Number.isFinite(updated) ? Math.floor(updated / 1000) : 0 };
}
