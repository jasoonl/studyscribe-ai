/**
 * Which StudyScribe server the extension talks to, and which pages it may
 * import. Everything that reaches the network goes through these checks.
 */

export const DEFAULT_ORIGIN = "https://studyscribe-ai.vercel.app";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type OriginResult = { ok: true; origin: string } | { ok: false; error: string };

/**
 * Turns what someone typed into a bare origin ("https://host[:port]").
 * HTTPS is required, except for a server on this computer, which may use
 * plain HTTP during development. Paths, queries and credentials are refused
 * rather than silently dropped, so a typo cannot point the extension at
 * something unexpected.
 */
export function normalizeOrigin(input: string): OriginResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter the address of your StudyScribe site." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That is not a web address." };
  }
  if (url.username || url.password) return { ok: false, error: "The address cannot contain a user name or password." };
  if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    return { ok: false, error: "Use the site address only, without a path." };
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    return { ok: false, error: "The address must start with https://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "The address must start with https://." };
  }
  return { ok: true, origin: url.origin };
}

/**
 * The host permission pattern for an origin. Chrome match patterns ignore the
 * port, so a local server on any port is covered by one pattern.
 */
export function originPermissionPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export type ImportCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Whether the active tab can be sent to `recordings.createFromUrl`. The server
 * makes the real decision (and its own SSRF checks); this only avoids sending
 * pages that can never work, such as the browser's own pages or StudyScribe.
 */
export function checkImportableUrl(rawUrl: string | undefined, origin: string): ImportCheck {
  if (!rawUrl) return { ok: false, reason: "Open a page with a lecture or a media file first." };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "This page has no address that can be imported." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Browser and extension pages cannot be imported." };
  }
  if (url.username || url.password) return { ok: false, reason: "Addresses with a user name or password cannot be imported." };
  if (isSameOrigin(url.href, origin)) return { ok: false, reason: "This is a StudyScribe page already." };
  if (url.href.length > 2048) return { ok: false, reason: "This address is too long to import." };
  return { ok: true, url: url.href };
}

/** Builds a link into the StudyScribe site, refusing anything that would leave it. */
export function siteUrl(origin: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Site paths must start with a single /");
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin) throw new Error("Site paths must stay on the StudyScribe site");
  return url.href;
}
