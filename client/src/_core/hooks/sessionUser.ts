import { clearOfflineData } from "@/lib/offlineStore";
import { clearAllPracticeDrafts } from "@/lib/practiceDrafts";
import { OFFLINE_OWNER_KEY } from "@/lib/offlinePack";
/**
 * One `/api/auth/me` request for everything that asks at once. ProtectedRoute,
 * the page and its header each used to ask on mount, three requests in a row
 * on every page load. Concurrent callers now share one request, and a result
 * from the last few seconds is reused, so a page mounting after the route
 * guard starts out signed in instead of showing a spinner again.
 */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

const REUSE_MS = 15_000;
let cached: { user: SessionUser | null; at: number } | null = null;
let inflight: Promise<SessionUser | null> | null = null;

export function peekSessionUser(): { user: SessionUser | null } | null {
  return cached && Date.now() - cached.at < REUSE_MS ? { user: cached.user } : null;
}

export function fetchSessionUser(fetcher: typeof fetch = fetch): Promise<SessionUser | null> {
  const fresh = peekSessionUser();
  if (fresh) return Promise.resolve(fresh.user);
  inflight ??= (async () => {
    try {
      const response = await fetcher("/api/auth/me", { credentials: "include" });
      const data = response.ok ? await response.json() : null;
      const user = (data?.user ?? data ?? null) as SessionUser | null;
      cached = { user, at: Date.now() };
      return user;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** After signing in or out, the next check must ask the server again. */
export function forgetSessionUser() {
  cached = null;
  clearAllPracticeDrafts();
  // Signing out also removes recordings kept offline, so a shared computer keeps nothing.
  void clearOfflineData();
  try {
    localStorage.removeItem(OFFLINE_OWNER_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}
