import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, time-limited links that let the transcription provider fetch a
 * recording's audio from this server rather than straight from blob storage.
 *
 * Two reasons this indirection exists:
 *  - Stored objects deliberately use a neutral `.bin` key and a generic
 *    content type to get past storage's content-type policy, which leaves a
 *    provider with no format hint at all. These links end in a real audio
 *    extension and are served with the real content type.
 *  - Storage's own signed URLs are short-lived; a provider that queues work
 *    may not download until well after they expire.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function getSigningSecret(): string {
  return process.env.JWT_SECRET || "default-dev-secret-change-in-production";
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

export function createTranscriptionAudioToken(key: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const expiresAt = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ k: key, e: expiresAt })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyTranscriptionAudioToken(token: string): string | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const { k, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { k: string; e: number };
    if (!k || typeof e !== "number" || Date.now() > e) return null;
    return k;
  } catch {
    return null;
  }
}

const LABEL_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/x-ms-wma": "wma",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpeg",
  "video/3gpp": "3gp",
  "video/x-ms-wmv": "wmv",
};

/** Builds the absolute URL a provider should fetch, ending in a real extension. */
export function buildTranscriptionAudioUrl(key: string, mimeType: string, baseUrl: string): string {
  const token = createTranscriptionAudioToken(key);
  const extension = LABEL_EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] ?? "mp3";
  return new URL(`/api/transcription-audio/${token}/audio.${extension}`, baseUrl).toString();
}
