import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed playback links for the mobile app (F1).
 *
 * The app's audio player streams from a URL and cannot attach an
 * Authorization header on every platform (and the lock-screen player keeps
 * fetching ranges after the screen that started it is gone), so it asks
 * `mobile.playbackUrl` for a link instead. The link is issued only after the
 * same access check as the storage proxy, names the user it was issued to,
 * and expires after a few hours. Same HMAC approach as
 * server/transcriptionAudioLink.ts, with its own purpose label so a
 * transcription link can never be used as a playback link or the reverse.
 */

export const PLAYBACK_TTL_MS = 6 * 60 * 60 * 1000;
const PURPOSE = "playback";

function secret() {
  return process.env.JWT_SECRET || "default-dev-secret-change-in-production";
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(`${PURPOSE}:${payload}`).digest("base64url");
}

export function createPlaybackToken(input: { key: string; userId: number | null; recordingId: number }, ttlMs = PLAYBACK_TTL_MS, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ k: input.key, u: input.userId, r: input.recordingId, e: now + ttlMs })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyPlaybackToken(token: string, now = Date.now()): { key: string; userId: number | null; recordingId: number } | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(token.slice(separator + 1));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { k?: unknown; u?: unknown; r?: unknown; e?: unknown };
    if (typeof data.k !== "string" || !data.k || typeof data.e !== "number" || now > data.e) return null;
    if (typeof data.r !== "number") return null;
    return { key: data.k, userId: typeof data.u === "number" ? data.u : null, recordingId: data.r };
  } catch {
    return null;
  }
}

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

/** Path of the playback link, ending in a real extension so native players pick the right decoder. */
export function playbackPath(token: string, mimeType: string) {
  const extension = EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] ?? "m4a";
  return `/api/storage/playback/${token}/audio.${extension}`;
}
