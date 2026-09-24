/**
 * Turns a web page URL into the direct media file(s) it publishes. Lecture
 * and talk pages (archive.org, Wikimedia Commons, university course sites,
 * podcast episode pages) rarely link the bare .mp3/.mp4 the way the user
 * pasted it, but they do expose it in standard, machine-readable places:
 * Open Graph tags, <audio>/<video>/<source> elements, JSON-LD, or a plain
 * download link. This only reads what the page itself publishes; it does not
 * touch player embeds or streaming manifests.
 */

const MEDIA_EXTENSION =
  /\.(mp3|m4a|m4b|aac|wav|flac|ogg|oga|opus|weba|webm|mp4|m4v|mov|ogv|mkv|avi|mpg|mpeg|3gp|wma|wmv|aif|aiff)(?:[?#]|$)/i;

const STREAMING_MANIFEST = /\.(m3u8|mpd)(?:[?#]|$)/i;

const MAX_CANDIDATES = 5;

const OG_MEDIA_KEYS = new Set([
  "og:audio", "og:audio:url", "og:audio:secure_url",
  "og:video", "og:video:url", "og:video:secure_url",
  "twitter:player:stream",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let match = pattern.exec(tag); match; match = pattern.exec(tag)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function isMediaType(type: string | undefined): boolean {
  if (!type) return false;
  const base = type.split(";")[0].trim().toLowerCase();
  return base.startsWith("audio/") || (base.startsWith("video/") && base !== "video/x-flv");
}

/** True when a declared type says "this is a player/page", not a media file. */
function isPlayerType(type: string | undefined): boolean {
  if (!type) return false;
  const base = type.split(";")[0].trim().toLowerCase();
  return base === "text/html" || base === "application/x-shockwave-flash";
}

export type MediaPageScan = {
  candidates: string[];
  /** True when the page only offers a streaming manifest (HLS/DASH) we can't fetch as a file. */
  hasStreamingManifest: boolean;
};

export function extractMediaCandidates(html: string, pageUrl: string): MediaPageScan {
  const ordered: string[] = [];
  let hasStreamingManifest = false;

  const add = (raw: string | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:") || trimmed.startsWith("javascript:")) return;
    let resolved: URL;
    try {
      resolved = new URL(trimmed, pageUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (STREAMING_MANIFEST.test(resolved.pathname)) {
      hasStreamingManifest = true;
      return;
    }
    const value = resolved.toString();
    if (!ordered.includes(value)) ordered.push(value);
  };

  const tags = html.match(/<(?:meta|audio|video|source|a)\b[^>]*>/gi) ?? [];

  // 1. Open Graph / Twitter card media: the page's own statement of "this is
  //    the media". Trusted first, but only when it isn't a player page.
  for (const tag of tags) {
    if (!/^<meta\b/i.test(tag)) continue;
    const attrs = parseAttributes(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (!OG_MEDIA_KEYS.has(key)) continue;
    const content = attrs.content;
    if (!content) continue;
    if (MEDIA_EXTENSION.test(content) || STREAMING_MANIFEST.test(content)) add(content);
  }

  // 2. Media elements in document order.
  for (const tag of tags) {
    if (!/^<(?:audio|video|source)\b/i.test(tag)) continue;
    const attrs = parseAttributes(tag);
    const src = attrs.src;
    if (!src) continue;
    if (isPlayerType(attrs.type)) continue;
    if (MEDIA_EXTENSION.test(src) || STREAMING_MANIFEST.test(src) || isMediaType(attrs.type)) add(src);
  }

  // 3. Structured data (VideoObject / AudioObject).
  for (const match of Array.from(html.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/g))) {
    const value = match[1].replace(/\\\//g, "/");
    if (MEDIA_EXTENSION.test(value) || STREAMING_MANIFEST.test(value)) add(value);
  }

  // 4. Plain download links.
  for (const tag of tags) {
    if (!/^<a\b/i.test(tag)) continue;
    const href = parseAttributes(tag).href;
    if (href && (MEDIA_EXTENSION.test(href) || STREAMING_MANIFEST.test(href))) add(href);
  }

  return { candidates: ordered.slice(0, MAX_CANDIDATES), hasStreamingManifest };
}

/** Reads at most `maxBytes` of a response body as text, cancelling the rest. */
export async function readTextLimited(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (seen >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}
