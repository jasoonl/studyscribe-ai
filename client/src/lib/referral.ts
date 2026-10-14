import { normaliseReferralCode, REFERRAL_REMEMBER_DAYS } from "@shared/referrals";

// Remembers the referral code a visitor arrived with (a ?ref= link, or a recording someone
// shared publicly) until they sign up, so the person who brought them is credited (Phase 7).
// Listed in the Cookie Policy as studyscribe_ref.
export const REFERRAL_KEY = "studyscribe_ref";

export function rememberReferral(code: string, { replace = true } = {}) {
  const normalised = normaliseReferralCode(code);
  if (!normalised) return;
  try {
    if (!replace && pendingReferral()) return;
    localStorage.setItem(REFERRAL_KEY, JSON.stringify({ code: normalised, at: Date.now() }));
  } catch {
    // Storage blocked: the referral just isn't remembered.
  }
}

export function pendingReferral(): string | null {
  try {
    const raw = localStorage.getItem(REFERRAL_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || typeof at !== "number" || Date.now() - at > REFERRAL_REMEMBER_DAYS * 86_400_000) {
      localStorage.removeItem(REFERRAL_KEY);
      return null;
    }
    return normaliseReferralCode(code);
  } catch {
    return null;
  }
}

export function forgetReferral() {
  try {
    localStorage.removeItem(REFERRAL_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Picks up ?ref=CODE on any page and removes it from the address bar. */
export function captureReferralFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const code = url.searchParams.get("ref");
  if (!code) return;
  rememberReferral(code);
  url.searchParams.delete("ref");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
