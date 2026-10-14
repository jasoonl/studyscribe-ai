/**
 * Where to go after signing in or signing up: a path on this site only.
 * Shared by the server (Google and SSO state) and the pages, which navigate
 * to it with `window.location.href`, so it must never name another site.
 *
 * Refused: anything not starting with one "/", "//host" and "/\host"
 * (protocol-relative), any backslash, control characters (browsers strip tabs
 * and newlines from URLs, so "/\t/evil.example" would become "//evil.example"),
 * API endpoints (a sign-in should never land on a GET with side effects), and
 * anything over 300 characters.
 */
export const MAX_NEXT_LENGTH = 300;

export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NEXT_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  const path = value.split(/[?#]/, 1)[0].toLowerCase();
  if (path === "/api" || path.startsWith("/api/")) return null;
  return value;
}

/** The current location as a `next` value for the login page, or null on the pages that need none. */
export function nextFromLocation(pathname: string, search = ""): string | null {
  if (pathname === "/" || pathname === "/login" || pathname === "/signup" || pathname === "/dashboard") return null;
  return safeNextPath(`${pathname}${search}`);
}
