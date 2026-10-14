import { LIVE_SAMPLE_RATE } from "@shared/liveTranscription";

/**
 * Live transcription while recording (A1), using AssemblyAI's streaming API
 * (v3, "Universal-Streaming").
 *
 * The browser holds the WebSocket to AssemblyAI itself, so no Vercel function
 * keeps a socket open. This module only mints the short-lived token the
 * browser connects with, so the API key never leaves the server:
 *
 *   GET https://streaming.assemblyai.com/v3/token
 *       ?expires_in_seconds=60               (window to open the socket, 1-600)
 *       &max_session_duration_seconds=3600   (how long that session may run, 60-10800)
 *   Authorization: <ASSEMBLYAI_API_KEY>
 *   -> { "token": "...", "expires_in_seconds": 60 }
 *
 *   wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le
 *       &speech_model=...&format_turns=true&token=...
 *
 * Streaming is billed per second the socket is open, so the browser closes it
 * whenever the recording is paused and live text is an opt-in per browser.
 * The finished file still goes through the batch pipeline for the real,
 * speaker-labelled transcript.
 *
 * Settings (all optional except the key):
 * - LIVE_TRANSCRIPTION=off turns the feature off for everyone (cost switch).
 * - ASSEMBLYAI_STREAMING_MODEL picks the streaming model.
 * - ASSEMBLYAI_STREAMING_HOST points at a data-residency host
 *   (streaming.eu.assemblyai.com) or, in development, a local mock server
 *   (http://127.0.0.1:7071). Plain http is only accepted for loopback hosts.
 */

export const LIVE_TOKEN_REDEEM_SECONDS = 60;
/** Each session is capped at an hour; the browser rolls over to a fresh one before that. */
export const LIVE_SESSION_SECONDS = 60 * 60;

export const STREAMING_MODELS = [
  "universal-streaming-multilingual",
  "universal-streaming-english",
  "universal-3-6-pro",
  "universal-3-5-pro",
] as const;
export type StreamingModel = (typeof STREAMING_MODELS)[number];
/** Cheapest model that still covers the most common lecture languages (EN, ES, DE, FR, PT, IT). */
export const DEFAULT_STREAMING_MODEL: StreamingModel = "universal-streaming-multilingual";

const DEFAULT_STREAMING_ORIGIN = "https://streaming.assemblyai.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type StreamingEndpoint = { httpOrigin: string; wsOrigin: string };

/** Resolves ASSEMBLYAI_STREAMING_HOST into the token and WebSocket origins, or explains why it can't. */
export function resolveStreamingEndpoint(raw = process.env.ASSEMBLYAI_STREAMING_HOST): StreamingEndpoint | { error: string } {
  const value = (raw ?? "").trim();
  if (!value) return { httpOrigin: DEFAULT_STREAMING_ORIGIN, wsOrigin: "wss://streaming.assemblyai.com" };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { error: `ASSEMBLYAI_STREAMING_HOST is not a valid host ("${value}").` };
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    return { error: "ASSEMBLYAI_STREAMING_HOST must use https unless it points at this computer." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "ASSEMBLYAI_STREAMING_HOST must be an http(s) host." };
  }
  if (!loopback && !/(^|\.)assemblyai\.com$/i.test(url.hostname)) {
    return { error: "ASSEMBLYAI_STREAMING_HOST must be an assemblyai.com host." };
  }
  const httpOrigin = url.origin;
  const wsOrigin = httpOrigin.replace(/^http/, "ws");
  return { httpOrigin, wsOrigin };
}

export function resolveStreamingModel(raw = process.env.ASSEMBLYAI_STREAMING_MODEL): StreamingModel {
  const value = (raw ?? "").trim() as StreamingModel;
  return STREAMING_MODELS.includes(value) ? value : DEFAULT_STREAMING_MODEL;
}

function liveSwitchedOff() {
  return /^(off|false|0|no|disabled)$/i.test((process.env.LIVE_TRANSCRIPTION ?? "").trim());
}

export type LiveAvailability =
  | { available: true }
  | { available: false; reason: "disabled" | "no_api_key" | "bad_host"; message: string };

export function getLiveAvailability(): LiveAvailability {
  if (liveSwitchedOff()) return { available: false, reason: "disabled", message: "Live transcription is turned off on this server." };
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return { available: false, reason: "no_api_key", message: "Live transcription is not set up on this server." };
  }
  const endpoint = resolveStreamingEndpoint();
  if ("error" in endpoint) return { available: false, reason: "bad_host", message: endpoint.error };
  return { available: true };
}

/** What the Admin page shows. Never includes the key. */
export function getLiveTranscriptionStatus() {
  const availability = getLiveAvailability();
  const endpoint = resolveStreamingEndpoint();
  return {
    available: availability.available,
    reason: availability.available ? null : availability.reason,
    message: availability.available ? null : availability.message,
    switchedOff: liveSwitchedOff(),
    model: resolveStreamingModel(),
    speakerLabels: liveSpeakerLabelsEnabled(),
    host: "error" in endpoint ? null : endpoint.wsOrigin,
    hostError: "error" in endpoint ? endpoint.error : null,
    maxSessionSeconds: LIVE_SESSION_SECONDS,
  };
}

/**
 * Streaming diarization (`speaker_labels`) labels each turn with its dominant
 * speaker ("A", "B", or "UNKNOWN" for turns under about a second). It is on by
 * default; `LIVE_SPEAKER_LABELS=off` leaves it out of the connection.
 */
export function liveSpeakerLabelsEnabled(raw = process.env.LIVE_SPEAKER_LABELS): boolean {
  return (raw ?? "").trim().toLowerCase() !== "off";
}

export function buildStreamingSocketUrl(wsOrigin: string, model: StreamingModel, speakerLabels = liveSpeakerLabelsEnabled()): string {
  const url = new URL("/v3/ws", wsOrigin);
  url.searchParams.set("sample_rate", String(LIVE_SAMPLE_RATE));
  url.searchParams.set("encoding", "pcm_s16le");
  url.searchParams.set("speech_model", model);
  // Universal-Streaming sends an unformatted final then a formatted one; the
  // client keeps only the formatted text. Universal-3 Pro formats anyway.
  url.searchParams.set("format_turns", "true");
  if (speakerLabels) url.searchParams.set("speaker_labels", "true");
  return url.toString();
}

export class LiveTokenError extends Error {
  constructor(message: string, readonly kind: "unavailable" | "provider") {
    super(message);
  }
}

export type LiveTokenGrant = {
  token: string;
  /** WebSocket URL without the token; the browser appends `token=`. */
  socketUrl: string;
  sampleRate: number;
  model: StreamingModel;
  /** Seconds left to open the socket with this token. */
  redeemWithinSeconds: number;
  /** How long a session opened with it may run. */
  maxSessionSeconds: number;
};

/** Asks AssemblyAI for a temporary streaming token. Short: one request, 10s timeout. */
export async function mintLiveToken(fetchImpl: typeof fetch = fetch): Promise<LiveTokenGrant> {
  const availability = getLiveAvailability();
  if (!availability.available) throw new LiveTokenError(availability.message, "unavailable");
  const endpoint = resolveStreamingEndpoint();
  if ("error" in endpoint) throw new LiveTokenError(endpoint.error, "unavailable");
  const model = resolveStreamingModel();

  const tokenUrl = new URL("/v3/token", endpoint.httpOrigin);
  tokenUrl.searchParams.set("expires_in_seconds", String(LIVE_TOKEN_REDEEM_SECONDS));
  tokenUrl.searchParams.set("max_session_duration_seconds", String(LIVE_SESSION_SECONDS));

  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "GET",
      headers: { Authorization: process.env.ASSEMBLYAI_API_KEY ?? "" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("[live] token request failed:", error instanceof Error ? error.message : error);
    throw new LiveTokenError("Could not reach the live transcription service.", "provider");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[live] token request returned ${response.status}: ${detail.slice(0, 200)}`);
    throw new LiveTokenError(
      response.status === 401 || response.status === 403
        ? "The live transcription service refused this server's credentials."
        : "The live transcription service is not available right now.",
      "provider",
    );
  }
  const body = (await response.json().catch(() => null)) as { token?: unknown; expires_in_seconds?: unknown } | null;
  if (!body || typeof body.token !== "string" || !body.token) {
    throw new LiveTokenError("The live transcription service sent back an unreadable token.", "provider");
  }
  const redeem = typeof body.expires_in_seconds === "number" && body.expires_in_seconds > 0 ? body.expires_in_seconds : LIVE_TOKEN_REDEEM_SECONDS;
  return {
    token: body.token,
    socketUrl: buildStreamingSocketUrl(endpoint.wsOrigin, model),
    sampleRate: LIVE_SAMPLE_RATE,
    model,
    redeemWithinSeconds: redeem,
    maxSessionSeconds: LIVE_SESSION_SECONDS,
  };
}
