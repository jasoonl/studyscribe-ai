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

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CHUNK_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type ClientProfile = {
  nameId: number;
  userAgent: string;
  context: Record<string, string | number>;
};

// Tried in order. The iOS client currently hands out plain (unencrypted) audio
// URLs; the Android VR client is the fallback when a host is challenged.
const CLIENTS: ClientProfile[] = [
  {
    nameId: 5,
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: {
      clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2",
      osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US",
    },
  },
  {
    nameId: 28,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: {
      clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceMake: "Oculus", deviceModel: "Quest 3",
      osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US",
    },
  },
];

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
    return "YouTube asked our server to prove it isn't a bot, so that video couldn't be fetched right now. Try again later, or download the audio and upload the file instead.";
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

export async function resolveYouTubeAudio(videoId: string): Promise<YouTubeAudio> {
  let lastFailure = "YouTube did not return any audio for that video.";

  for (const client of CLIENTS) {
    let response: Response;
    try {
      response = await fetch(PLAYER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": client.userAgent,
          "x-youtube-client-name": String(client.nameId),
          "x-youtube-client-version": String(client.context.clientVersion),
        },
        body: JSON.stringify({ context: { client: client.context }, videoId, contentCheckOk: true, racyCheckOk: true }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastFailure = `Could not reach YouTube: ${error instanceof Error ? error.message : "network error"}`;
      continue;
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      lastFailure = `YouTube returned an unexpected response (${response.status}).`;
      continue;
    }

    const playability = data?.playabilityStatus;
    if (playability?.status !== "OK") {
      lastFailure = describePlayabilityFailure(playability?.status, playability?.reason);
      // Private, removed and members-only videos fail identically on every client.
      if (/private|removed|unavailable|members|terminated|copyright/i.test(playability?.reason ?? "")) break;
      continue;
    }

    const details = data?.videoDetails ?? {};
    if (details.isLive || (details.isLiveContent === true && !details.lengthSeconds)) {
      throw new Error("That is a live stream. Import it after the stream has ended.");
    }

    const format = pickAudioFormat(data?.streamingData?.adaptiveFormats ?? []);
    if (!format) {
      lastFailure = "YouTube did not offer a downloadable audio track for that video.";
      continue;
    }

    let host = "";
    try {
      host = new URL(format.url).hostname;
    } catch {
      // handled below
    }
    if (host !== "googlevideo.com" && !host.endsWith(".googlevideo.com")) {
      lastFailure = "YouTube returned an unexpected download address.";
      continue;
    }

    const length = Number(format.contentLength);
    const duration = Number(details.lengthSeconds);
    return {
      url: format.url,
      mimeType: (format.mimeType ?? "audio/mp4").split(";")[0].trim(),
      contentLength: Number.isFinite(length) && length > 0 ? length : null,
      title: typeof details.title === "string" ? details.title : "",
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
      userAgent: client.userAgent,
    };
  }

  throw new Error(lastFailure);
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
          response = await fetch(url, { headers: { "user-agent": audio.userAgent }, signal: AbortSignal.timeout(30_000) });
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
