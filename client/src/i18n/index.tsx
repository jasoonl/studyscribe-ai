import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import en from "@shared/i18n/en";
import {
  DEFAULT_UI_LANGUAGE,
  htmlLangFor,
  interpolate,
  isUiLanguage,
  matchUiLanguage,
  pluralSuffix,
  type MessageKey,
  type MessageVars,
  type Messages,
  type PluralKey,
  type UiLanguage,
} from "@shared/i18n";

/**
 * Interface language on the web (Phase 7). English ships in the main bundle; another language
 * loads as its own small chunk before the app first renders (`initUiLanguage` in main.tsx), so
 * nobody sees English flash first. The choice is per browser (`studyscribe_ui_language`); with
 * none saved, the browser's own language preferences decide.
 */

export const UI_LANGUAGE_KEY = "studyscribe_ui_language";

const loaders: Record<Exclude<UiLanguage, "en">, () => Promise<{ default: Messages }>> = {
  es: () => import("@shared/i18n/es"),
  fr: () => import("@shared/i18n/fr"),
  zh: () => import("@shared/i18n/zh"),
  ja: () => import("@shared/i18n/ja"),
  ko: () => import("@shared/i18n/ko"),
};

let language: UiLanguage = DEFAULT_UI_LANGUAGE;
let messages: Messages = en;
const listeners = new Set<() => void>();

function savedLanguage(): UiLanguage | null {
  try {
    const value = localStorage.getItem(UI_LANGUAGE_KEY);
    return isUiLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

async function apply(next: UiLanguage) {
  try {
    messages = next === "en" ? en : (await loaders[next]()).default;
    language = next;
  } catch (error) {
    // A chunk that fails to load (offline, a new deploy) leaves the interface in English.
    console.warn("[i18n] could not load", next, error);
    messages = en;
    language = "en";
  }
  if (typeof document !== "undefined") document.documentElement.lang = htmlLangFor(language);
  listeners.forEach((listener) => listener());
}

export function initUiLanguage() {
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  return apply(savedLanguage() ?? matchUiLanguage(preferred));
}

export async function setUiLanguage(next: UiLanguage) {
  try {
    localStorage.setItem(UI_LANGUAGE_KEY, next);
  } catch {
    // Private windows can refuse storage; the change still applies to this visit.
  }
  await apply(next);
}

export function getUiLanguage() {
  return language;
}

/** A message in the current language. Usable outside components, such as in toasts. */
export function t(key: MessageKey, vars?: MessageVars) {
  return interpolate(messages[key] ?? en[key] ?? key, vars);
}

/** A counted message: `tn("library.recordings", 3)` reads `library.recordings_other` with {count}. */
export function tn(key: PluralKey, count: number, vars?: MessageVars) {
  const full = `${key}_${pluralSuffix(language, count)}` as MessageKey;
  return t(full in en ? full : (`${key}_other` as MessageKey), { count: formatNumber(count), ...vars });
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(htmlLangFor(language), options).format(value);
}

export function formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleDateString(htmlLangFor(language), options);
}

/**
 * A due date said the way people say it: "today", "tomorrow", "3 days ago" (Intl.RelativeTimeFormat,
 * so every language words it naturally), else a short date. Both dates are zone-less YYYY-MM-DD.
 */
export function formatDueDate(dueDate: string, todayIso: string) {
  const locale = htmlLangFor(language);
  const [y1, m1, d1] = todayIso.split("-").map(Number);
  const [y2, m2, d2] = dueDate.split("-").map(Number);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  if (days >= -13 && days <= 1) {
    const text = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  }
  return new Date(y2, m2 - 1, d2).toLocaleDateString(locale, {
    weekday: days > 0 && days < 7 ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: y1 === y2 ? undefined : "numeric",
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the component when the language changes. */
export function useI18n() {
  const current = useSyncExternalStore(subscribe, getUiLanguage, getUiLanguage);
  return { language: current, t, tn, formatDate, formatDueDate, formatNumber, setLanguage: setUiLanguage };
}

/**
 * A message with links or emphasis inside it: `<terms>Terms</terms>` in the text becomes
 * `parts.terms("Terms")`. Tags don't nest; an unknown tag shows its text plainly.
 */
export function Trans({ k, vars, parts }: { k: MessageKey; vars?: MessageVars; parts: Record<string, (text: string) => ReactNode> }) {
  useI18n();
  const text = t(k, vars);
  const nodes: ReactNode[] = [];
  const pattern = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  for (const match of Array.from(text.matchAll(pattern))) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const render = parts[match[1]];
    nodes.push(<Fragment key={start}>{render ? render(match[2]) : match[2]}</Fragment>);
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
