/**
 * The desktop shell's security rules, as pure functions so they can be tested
 * without Electron: which origin the app loads, what may navigate inside the
 * window, what opens in the browser, and what a studyscribe:// link may open.
 */

export const DEFAULT_ORIGIN = "https://studyscribe-ai.vercel.app";
export const PROTOCOL = "studyscribe";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Hosts the app window may visit besides its own origin: Google's sign-in
 * page, which "Continue with Google" redirects through and which then
 * returns to the app's origin. Everything else opens in the browser.
 */
export const SIGN_IN_HOSTS = new Set(["accounts.google.com"]);

/** A bare https origin, or http for this computer only. Null when the input is anything else. */
export function normalizeOrigin(input: string | undefined | null): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

/**
 * Where the app loads from, first match wins: `--url=<origin>` on the command
 * line, the STUDYSCRIBE_URL environment variable, the saved setting, then
 * production. Invalid values are skipped rather than trusted.
 */
export function resolveOrigin(sources: { argv: string[]; env: string | undefined; saved: string | undefined }): string {
  const fromArgs = sources.argv.find(arg => arg.startsWith("--url="))?.slice("--url=".length);
  return normalizeOrigin(fromArgs) ?? normalizeOrigin(sources.env) ?? normalizeOrigin(sources.saved) ?? DEFAULT_ORIGIN;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isAppUrl(url: string, origin: string): boolean {
  return parse(url)?.origin === origin;
}

/** Whether the main window may navigate to `url` (its own origin, or the sign-in page over https). */
export function isAllowedNavigation(url: string, origin: string): boolean {
  const target = parse(url);
  if (!target) return false;
  if (target.origin === origin) return true;
  return target.protocol === "https:" && SIGN_IN_HOSTS.has(target.hostname);
}

/** Links that leave the app open in the default browser; only web and mail links, never file: or custom schemes. */
export function isExternalLink(url: string): boolean {
  const target = parse(url);
  return Boolean(target && (target.protocol === "https:" || target.protocol === "http:" || target.protocol === "mailto:"));
}

/**
 * Maps studyscribe://<path> to a path inside the app, e.g.
 * studyscribe://recording/12 -> /recording/12 and studyscribe://record -> /record.
 * Only plain app paths are allowed: no API routes, no other hosts, no
 * encoded slashes, at most a short query string.
 */
export function deepLinkPath(link: string): string | null {
  const url = parse(link);
  if (!url || url.protocol !== `${PROTOCOL}:`) return null;
  // studyscribe://recording/12 parses with host "recording"; studyscribe:///recording/12 with an empty host.
  const path = `/${[url.hostname, ...url.pathname.split("/")].filter(Boolean).join("/")}`;
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path) || path.startsWith("/api") || path.includes("//")) return null;
  const query = url.search;
  if (query && !/^\?[A-Za-z0-9=&_.-]{1,200}$/.test(query)) return null;
  return path === "/" ? "/dashboard" : `${path}${query}`;
}

export function findDeepLink(argv: string[]): string | null {
  return argv.find(arg => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}

/** Permissions the web app needs, granted to its own origin only. */
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write", "fullscreen"]);

export function isAllowedPermission(permission: string, requestingUrl: string, origin: string, mediaTypes: string[] = []): boolean {
  if (!isAppUrl(requestingUrl, origin) || !ALLOWED_PERMISSIONS.has(permission)) return false;
  // Microphone (and the audio of a screen share) only; the app never needs the camera.
  if (permission === "media" && mediaTypes.some(type => type !== "audio")) return false;
  return true;
}

/** Bounds for the compact Study help window: the top-right corner of the work area, inside a margin. */
export function compactBounds(workArea: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(420, workArea.width - 32);
  const height = Math.min(680, workArea.height - 32);
  return { x: workArea.x + workArea.width - width - 16, y: workArea.y + 16, width, height };
}

/** Pages that show the recorder, live transcript and Study help; compact mode opens /record unless one is already showing. */
export function studyHelpPath(currentUrl: string, origin: string): string | null {
  const url = parse(currentUrl);
  if (!url || url.origin !== origin) return "/record";
  if (url.pathname === "/record" || url.pathname === "/record-or-upload") return null;
  return "/record";
}
