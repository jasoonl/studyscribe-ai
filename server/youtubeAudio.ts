/**
 * Resolves a YouTube link to its audio track so it can flow through the normal
 * link-import pipeline (storage, duration probe, transcription).
 *
 * This asks YouTube's own player endpoint for the video's audio streams the
 * way its mobile apps do, then downloads one in ranged chunks. It is not an
 * official API: YouTube can change or block it, and some hosts get a "sign in
 * to confirm you're not a bot" response for any request. Every failure path
 * therefore ends in an explanatory error rather than a hang.
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CHUNK_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type ClientProfile = {
  name: string;
  nameId: number;
  userAgent: string;
  context: Record<string, string | number>;
};

// Tried in order. YouTube decides per client (and per requesting IP) whether to
// hand out a stream or a bot check, so more than one is kept and the first that
// works wins. The embedded-player and mobile-web clients were tried and dropped:
// they answer "unavailable" or "reload the page" for healthy videos, which
// would mask the real reason.
export const CLIENTS: ClientProfile[] = [
  {
    name: "IOS", nameId: 5,
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" },
  },
  {
    name: "ANDROID_VR", nameId: 28,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceMake: "Oculus", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US" },
  },
  {
    name: "TV", nameId: 7,
    userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
    context: { clientName: "TVHTML5", clientVersion: "7.20250312.16.00", hl: "en", gl: "US" },
  },
];

let proxyAgent: { url: string; agent: ProxyAgent } | null = null;

export function isYouTubeProxyConfigured() {
  return Boolean(process.env.YOUTUBE_PROXY_URL);
}

/**
 * YouTube answers requests from datacenter networks (Vercel, AWS and the like)
 * with a "confirm you're not a bot" challenge no matter which client is used,
 * so from a serverless host nothing works without an egress that looks like a
 * home connection. When YOUTUBE_PROXY_URL is set (http://user:pass@host:port,
 * ideally a residential proxy with a sticky session) every YouTube request,
 * including the audio download, goes through it. The stream URL YouTube issues
 * is bound to the address that asked for it, so both must use the same egress.
 */
function youtubeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const proxyUrl = process.env.YOUTUBE_PROXY_URL;
  if (!proxyUrl) return fetch(input, init);
  if (!proxyAgent || proxyAgent.url !== proxyUrl) proxyAgent = { url: proxyUrl, agent: new ProxyAgent(proxyUrl) };
  return undiciFetch(input as any, { ...(init as any), dispatcher: proxyAgent.agent }) as unknown as Promise<Response>;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Returns the video id for a single-video YouTube link, or null for anything else. */
export function parseYouTubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") candidate = url.searchParams.get("v");
    else if (first === "shorts" || first === "live" || first === "embed" || first === "v") candidate = second ?? null;
  }

  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** True for a YouTube address that is not a single video (channel, playlist, home). */
export function isYouTubeNonVideoLink(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
    return (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") && !parseYouTubeVideoId(rawUrl);
  } catch {
    return false;
  }
}

type PlayerFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  audioTrack?: { audioIsDefault?: boolean };
};

/**
 * Chooses the audio stream to transcribe. AAC in MP4 (itag 140, ~128kbps) is
 * preferred: it is what storage, the duration probe and the transcription
 * provider all handle without surprises. Dubbed videos list one stream per
 * language; only the original/default track is considered.
 */
export function pickAudioFormat(formats: PlayerFormat[]): (PlayerFormat & { url: string }) | null {
  const usable = formats.filter(
    (format): format is PlayerFormat & { url: string } =>
      Boolean(format.url) && (format.mimeType ?? "").startsWith("audio/") && format.audioTrack?.audioIsDefault !== false,
  );
  const closestTo128k = (a: PlayerFormat, b: PlayerFormat) =>
    Math.abs((a.bitrate ?? 0) - 128_000) - Math.abs((b.bitrate ?? 0) - 128_000);

  const mp4 = usable.filter((format) => format.mimeType!.startsWith("audio/mp4")).sort(closestTo128k);
  if (mp4.length > 0) return mp4[0];
  const webm = usable.filter((format) => format.mimeType!.startsWith("audio/webm")).sort(closestTo128k);
  return webm[0] ?? null;
}

export function describePlayabilityFailure(status: string | undefined, reason: string | undefined): string {
  const detail = (reason ?? "").trim();
  if (/age/i.test(detail) && /confirm|verify|restricted/i.test(detail)) {
    return "That video is age-restricted, which YouTube only serves to signed-in viewers. Download the audio and upload the file instead.";
  }
  if (/not a bot|sign in to confirm/i.test(detail)) {
    return isYouTubeProxyConfigured()
      ? "YouTube still asked our server to prove it isn't a bot, even through the configured proxy. The proxy's address may be flagged; try again later, or download the audio and upload the file instead."
      : "YouTube blocks this server's network (it asks it to prove it isn't a bot), so YouTube links can't be fetched from here without a proxy. Download the audio and upload the file instead.";
  }
  if (detail) return `YouTube can't provide that video: ${detail}`;
  return `YouTube can't provide that video (${status ?? "unavailable"}).`;
}

export type YouTubeAudio = {
  url: string;
  mimeType: string;
  contentLength: number | null;
  title: string;
  durationSec: number | null;
  userAgent: string;
};

type PlayerAttempt =
  | { ok: true; audio: YouTubeAudio }
  | { ok: false; reason: string; final?: boolean; live?: boolean };

async function requestPlayer(client: ClientProfile, videoId: string): Promise<PlayerAttempt> {
  let response: Response;
  try {
    response = await youtubeFetch(PLAYER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": client.userAgent,
        "x-youtube-client-name": String(client.nameId),
        "x-youtube-client-version": String(client.context.clientVersion),
      },
      body: JSON.stringify({
        context: { client: client.context },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: `Could not reach YouTube: ${error instanceof Error ? error.message : "network error"}` };
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: `YouTube returned an unexpected response (${response.status}).` };
  }

  const playability = data?.playabilityStatus;
  if (playability?.status !== "OK") {
    return {
      ok: false,
      reason: describePlayabilityFailure(playability?.status, playability?.reason),
      // Private, removed and members-only videos fail identically on every client.
      final: /private|removed|members|terminated|copyright/i.test(playability?.reason ?? ""),
    };
  }

  const details = data?.videoDetails ?? {};
  if (details.isLive || (details.isLiveContent === true && !details.lengthSeconds)) {
    return { ok: false, reason: "That is a live stream. Import it after the stream has ended.", final: true, live: true };
  }

  const format = pickAudioFormat(data?.streamingData?.adaptiveFormats ?? []);
  if (!format) return { ok: false, reason: "YouTube did not offer a downloadable audio track for that video." };

  let host = "";
  try {
    host = new URL(format.url).hostname;
  } catch {
    // handled below
  }
  if (host !== "googlevideo.com" && !host.endsWith(".googlevideo.com")) {
    return { ok: false, reason: "YouTube returned an unexpected download address." };
  }

  const length = Number(format.contentLength);
  const duration = Number(details.lengthSeconds);
  return {
    ok: true,
    audio: {
      url: format.url,
      mimeType: (format.mimeType ?? "audio/mp4").split(";")[0].trim(),
      contentLength: Number.isFinite(length) && length > 0 ? length : null,
      title: typeof details.title === "string" ? details.title : "",
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
      userAgent: client.userAgent,
    },
  };
}

export async function resolveYouTubeAudio(videoId: string): Promise<YouTubeAudio> {
  let lastFailure = "YouTube did not return any audio for that video.";
  for (const client of CLIENTS) {
    const attempt = await requestPlayer(client, videoId);
    if (attempt.ok) return attempt.audio;
    lastFailure = attempt.reason;
    if (attempt.live) throw new Error(attempt.reason);
    if (attempt.final) break;
  }
  throw new Error(lastFailure);
}

/** Admin diagnostic: what each client gets from this server's network right now. */
export async function probeYouTubeClients(videoId: string) {
  return Promise.all(
    CLIENTS.map(async (client) => {
      const attempt = await requestPlayer(client, videoId);
      return attempt.ok
        ? { client: client.name, ok: true as const, detail: `${attempt.audio.mimeType}, ${attempt.audio.contentLength ?? "unknown"} bytes` }
        : { client: client.name, ok: false as const, detail: attempt.reason };
    }),
  );
}

/**
 * Streams the audio in fixed-size ranged requests. YouTube's download hosts
 * throttle or refuse a single open-ended request but serve ranges quickly.
 */
export function youtubeAudioStream(audio: Pick<YouTubeAudio, "url" | "contentLength" | "userAgent">): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (audio.contentLength !== null && offset >= audio.contentLength) {
        controller.close();
        return;
      }
      const end = offset + CHUNK_BYTES - 1;
      const url = new URL(audio.url);
      url.searchParams.set("range", `${offset}-${end}`);

      let response: Response | null = null;
      for (let attempt = 0; attempt < 2 && !response?.ok; attempt++) {
        try {
          response = await youtubeFetch(url, { headers: { "user-agent": audio.userAgent }, signal: AbortSignal.timeout(30_000) });
        } catch {
          response = null;
        }
      }
      if (!response || !response.ok) {
        controller.error(new Error(`YouTube stopped sending the audio (${response?.status ?? "network error"}).`));
        return;
      }

      const chunk = new Uint8Array(await response.arrayBuffer());
      if (chunk.byteLength === 0) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      offset += chunk.byteLength;
      // Without a declared length, a short chunk means we reached the end.
      if (audio.contentLength === null && chunk.byteLength < CHUNK_BYTES) controller.close();
    },
  });
}
