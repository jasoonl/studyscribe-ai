// After a deploy, a tab opened on the previous version asks for page files that no longer
// exist (every build renames them), so opening another page failed with a stack trace.
// Reloading once picks up the new version; the timestamp stops a loop if a file is really missing.

export const STALE_BUILD_RELOAD_KEY = "studyscribe_reloaded_for_update";
const RETRY_AFTER_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's CSS preload
  /'text\/html' is not a valid JavaScript MIME type/i, // Safari, when the file came back as the app page
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** True when a reload is allowed now (none in the last minute in this tab). */
export function mayReloadForUpdate(now = Date.now(), storage: Pick<Storage, "getItem"> | null = safeSession()): boolean {
  const last = Number(storage?.getItem(STALE_BUILD_RELOAD_KEY) ?? 0);
  return !Number.isFinite(last) || now - last > RETRY_AFTER_MS;
}

/** Reloads the page for a newer version once; returns false when it already tried. */
export function reloadForUpdate(): boolean {
  if (typeof window === "undefined" || !mayReloadForUpdate()) return false;
  try {
    safeSession()?.setItem(STALE_BUILD_RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: still reload; the browser's own cache keeps this from looping fast.
  }
  window.location.reload();
  return true;
}

/** Vite reports a failed preload of a page's files as `vite:preloadError`; reload instead of failing. */
export function reloadOnStaleBuild() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForUpdate()) event.preventDefault();
  });
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
