import { inject as injectVercelAnalytics } from "@vercel/analytics";

/**
 * Cookie and analytics consent. The only cookie is the essential session cookie, so the choice
 * only gates analytics: nothing is loaded until the visitor accepts, and a browser's Global
 * Privacy Control signal counts as declining until they choose otherwise.
 */
export type ConsentChoice = "accepted" | "declined";

export const CONSENT_KEY = "studyscribe_cookie_consent";
export const COOKIE_SETTINGS_EVENT = "studyscribe:cookie-settings";

const UMAMI_ENDPOINT = (import.meta.env.VITE_ANALYTICS_ENDPOINT as string | undefined)?.trim();
const UMAMI_WEBSITE_ID = (import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined)?.trim();
/** True when the optional Umami analytics script is configured for this build. */
export const UMAMI_CONFIGURED = Boolean(UMAMI_ENDPOINT && UMAMI_WEBSITE_ID);

let analyticsLoaded = false;

export function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

export function hasGlobalPrivacyControl() {
  return typeof navigator !== "undefined" && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Whether to ask: no saved choice and no Global Privacy Control signal. */
export function needsConsentChoice() {
  return readConsent() === null && !hasGlobalPrivacyControl();
}

export function loadAnalytics() {
  if (analyticsLoaded || typeof window === "undefined") return;
  analyticsLoaded = true;
  injectVercelAnalytics({ mode: "auto" });
  if (UMAMI_CONFIGURED) {
    const script = document.createElement("script");
    script.defer = true;
    script.src = `${UMAMI_ENDPOINT}/umami`;
    script.dataset.websiteId = UMAMI_WEBSITE_ID;
    document.head.appendChild(script);
  }
}

/** Saves the choice. Returns true when analytics were already running and need a reload to stop. */
export function saveConsent(choice: ConsentChoice): boolean {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  if (choice === "accepted") {
    loadAnalytics();
    return false;
  }
  return analyticsLoaded;
}

export function startAnalyticsIfConsented() {
  if (readConsent() === "accepted") loadAnalytics();
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
