import { lookup } from "node:dns/promises";
import net from "node:net";
import { extractMediaCandidates, readTextLimited } from "./mediaPageResolver";

/**
 * Importing audio from a user-supplied link means this server makes an
 * outbound request to an address the user chooses, which is a server-side
 * request forgery primitive unless it is constrained. Every hostname is
 * resolved and checked against private/loopback/link-local space before any
 * connection, and redirects are followed manually so each hop gets the same
 * treatment — a public hostname that 302s to 169.254.169.254 (cloud instance
 * metadata) or 127.0.0.1 must not slip through.
 */

const MAX_REDIRECTS = 3;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "StudyScribeImporter/1.0 (+https://studyscribe-ai.vercel.app)";

/** Player pages whose terms prohibit extracting the underlying media stream. */
const STREAMING_PAGE_HOSTS = [
  "youtube.com", "youtu.be", "music.youtube.com",
  "spotify.com", "open.spotify.com",
  "netflix.com", "hulu.com", "vimeo.com", "twitch.tv",
  "soundcloud.com", "tiktok.com", "instagram.com", "facebook.com",
];

const IMPORTABLE_CONTENT_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/aac", "audio/flac", "audio/x-flac",
  // Video links are accepted too — the transcription provider extracts the
  // audio track itself, so a talk published as MP4 works the same as one
  // published as MP3. Many static hosts also fall back to a generic type.
  "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
  "audio/opus", "audio/aiff", "audio/x-aiff", "audio/x-ms-wma",
  "video/ogg", "video/x-matroska", "video/x-msvideo", "video/mpeg",
  "video/3gpp", "video/x-ms-wmv",
  "application/octet-stream", "binary/octet-stream",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  webm: "audio/webm",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/mp4",
  flac: "audio/flac",
  // Video containers map to their audio-equivalent type; the provider pulls
  // the audio track out and the browser plays it back the same way.
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  wmv: "video/x-ms-wmv",
  wma: "audio/x-ms-wma",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isDisallowedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  const inRange = (cidr: string, bits: number) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(cidr) & mask);
  };
  return (
    inRange("0.0.0.0", 8) ||        // "this network"
    inRange("10.0.0.0", 8) ||       // private
    inRange("100.64.0.0", 10) ||    // carrier-grade NAT
    inRange("127.0.0.0", 8) ||      // loopback
    inRange("169.254.0.0", 16) ||   // link-local, incl. cloud metadata
    inRange("172.16.0.0", 12) ||    // private
    inRange("192.0.0.0", 24) ||     // IETF protocol assignments
    inRange("192.0.2.0", 24) ||     // TEST-NET-1
    inRange("192.168.0.0", 16) ||   // private
    inRange("198.18.0.0", 15) ||    // benchmarking
    inRange("198.51.100.0", 24) ||  // TEST-NET-2
    inRange("203.0.113.0", 24) ||   // TEST-NET-3
    inRange("224.0.0.0", 4) ||      // multicast
    inRange("240.0.0.0", 4)         // reserved / broadcast
  );
}

function isDisallowedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0];

  // IPv4-mapped (::ffff:127.0.0.1) must be judged on the embedded address.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isDisallowedIpv4(mapped[1]);

  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80") || normalized.startsWith("fec0")) return true; // link/site-local
  if (/^f[cd]/.test(normalized)) return true;                                       // unique local fc00::/7
  if (normalized.startsWith("ff")) return true;                                     // multicast
  if (normalized.startsWith("2001:db8")) return true;                               // documentation
  return false;
}

export function isDisallowedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isDisallowedIpv4(ip);
  if (net.isIPv6(ip)) return isDisallowedIpv6(ip);
  return true; // not a resolvable literal address — refuse rather than guess
}

/** Parses and validates a single URL, resolving DNS and rejecting non-public targets. */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That does not look like a valid link.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links can be imported.");
  }

  // These return a player page, not a media file, and their terms prohibit
  // extracting the underlying stream. Saying so beats a confusing
  // "that link is text/html, not an audio file".
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (STREAMING_PAGE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    throw new Error(
      `${host} links can't be imported — their terms don't allow downloading the media. Use a direct link to an audio or video file, or a page that hosts the file itself (like archive.org). If it's your own video, download the file from the site and upload it instead.`,
    );
  }

  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isDisallowedAddress(literal)) throw new Error("That link points to a private address.");
    return url;
  }

  let resolved;
  try {
    resolved = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error("That link's domain could not be resolved.");
  }

  if (resolved.length === 0) throw new Error("That link's domain could not be resolved.");
  // Every resolved address must be public: a host resolving to both a public
  // and a private address must not be usable to reach the private one.
  for (const entry of resolved) {
    if (isDisallowedAddress(entry.address)) {
      throw new Error("That link points to a private address.");
    }
  }

  return url;
}

export function guessMimeTypeFromUrl(url: string): string | null {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_TYPES[extension] ?? null;
}

type FetchedAudio = {
  body: ReadableStream<Uint8Array>;
  mimeType: string;
  contentLength: number | null;
  finalUrl: string;
};

const PAGE_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const MAX_PAGE_CANDIDATE_TRIES = 4;

/**
 * Resolves the final response for a link, validating every redirect hop.
 * Returns the response body stream plus what we could learn about the audio.
 *
 * A link may also be a web page that publishes the media (an archive.org or
 * Wikimedia Commons item, a course page with an embedded player). In that
 * case the page's own media links are tried in order — one level deep only,
 * and each candidate goes through the same address checks as the original.
 */
export async function fetchAudioFromUrl(
  rawUrl: string,
  options: { fromPage?: string } = {},
): Promise<FetchedAudio> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpUrl(currentUrl);

    const headers: Record<string, string> = { Accept: "audio/*,video/*,text/html;q=0.8,*/*;q=0.5", "User-Agent": USER_AGENT };
    if (options.fromPage) headers.Referer = options.fromPage;

    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", headers });
    } catch (error) {
      throw new Error(`Could not download that link: ${error instanceof Error ? error.message : "network error"}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("That link redirected without a destination.");
      currentUrl = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`That link returned ${response.status} and could not be downloaded.`);
    }

    const declaredType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const guessedType = guessMimeTypeFromUrl(url.toString());

    // Trust the response over the URL: a ".mp3" link that answers with HTML is
    // a soft-404, login wall or hotlink-protection page, never the audio.
    if (PAGE_CONTENT_TYPES.has(declaredType)) {
      return resolveMediaFromPage(response, url, options.fromPage !== undefined);
    }

    if (declaredType && !IMPORTABLE_CONTENT_TYPES.has(declaredType) && !guessedType) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`That link is ${declaredType}, not an audio file.`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`That audio file is larger than ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))}MB.`);
    }

    if (!response.body) throw new Error("That link returned an empty response.");

    // Prefer a concrete type from the URL over a generic server-declared one.
    const isGeneric = !declaredType || declaredType.endsWith("octet-stream");
    const mimeType = (isGeneric ? guessedType : declaredType) ?? guessedType ?? "audio/mpeg";

    return { body: response.body, mimeType, contentLength, finalUrl: url.toString() };
  }

  throw new Error("That link redirected too many times.");
}

async function resolveMediaFromPage(response: Response, pageUrl: URL, alreadyOnPage: boolean): Promise<FetchedAudio> {
  const notMedia = "That link is a web page, not an audio file";
  if (alreadyOnPage || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${notMedia}.`);
  }

  const html = await readTextLimited(response.body, MAX_PAGE_BYTES);
  const { candidates, hasStreamingManifest } = extractMediaCandidates(html, pageUrl.toString());

  if (candidates.length === 0) {
    throw new Error(
      hasStreamingManifest
        ? `${notMedia}, and the video on it is a live-style stream (HLS/DASH) that can't be downloaded as a file. Use a link to the audio or video file itself.`
        : `${notMedia}, and no downloadable audio or video file was found on it. If the page only has an embedded player (YouTube, Vimeo, etc.), paste a direct link to the file instead.`,
    );
  }

  let lastError = "";
  for (const candidate of candidates.slice(0, MAX_PAGE_CANDIDATE_TRIES)) {
    try {
      return await fetchAudioFromUrl(candidate, { fromPage: pageUrl.toString() });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "download failed";
    }
  }
  throw new Error(`Found audio or video on that page, but couldn't download it: ${lastError}`);
}

/** Caps an in-flight download so an unbounded or lying Content-Length can't exhaust memory. */
export function limitStreamSize(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let seen = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(
            new Error(`That audio file is larger than ${Math.floor(maxBytes / (1024 * 1024))}MB.`),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
