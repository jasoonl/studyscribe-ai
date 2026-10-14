/**
 * Interface languages (Phase 7). English is the source: `en.ts` holds every message and its
 * keys are the type every other language must fill completely, so a missing translation is a
 * type error rather than a blank button. Plain TypeScript, so the mobile app can reuse it.
 */
import type { Messages, MessageKey } from "./en";

export type { Messages, MessageKey };

export const UI_LANGUAGES = [
  { code: "en", name: "English", htmlLang: "en" },
  { code: "es", name: "Español", htmlLang: "es" },
  { code: "fr", name: "Français", htmlLang: "fr" },
  { code: "zh", name: "简体中文", htmlLang: "zh-Hans" },
  { code: "ja", name: "日本語", htmlLang: "ja" },
  { code: "ko", name: "한국어", htmlLang: "ko" },
] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number]["code"];

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && UI_LANGUAGES.some((language) => language.code === value);
}

/** The first of the browser's preferred languages we have, by its primary subtag ("es-MX" is "es"). */
export function matchUiLanguage(preferred: readonly string[]): UiLanguage {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isUiLanguage(primary)) return primary;
  }
  return DEFAULT_UI_LANGUAGE;
}

export function htmlLangFor(language: UiLanguage) {
  return UI_LANGUAGES.find((entry) => entry.code === language)?.htmlLang ?? "en";
}

export type MessageVars = Record<string, string | number>;

/** Fills `{name}` placeholders. A placeholder without a value stays as written, so a mistake is visible. */
export function interpolate(template: string, vars?: MessageVars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Keys written as `<base>_one` / `<base>_other`; `tn` picks one by Intl.PluralRules. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}_other` ? Base : never) : never;

export function pluralSuffix(language: UiLanguage, count: number): "one" | "other" {
  return new Intl.PluralRules(htmlLangFor(language)).select(count) === "one" ? "one" : "other";
}

/** Placeholder names in a message, for checking translations keep every one. */
export function placeholders(template: string) {
  return Array.from(template.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
}

/** Tag names in a message (`<terms>…</terms>`), for the same check. */
export function tags(template: string) {
  return Array.from(template.matchAll(/<(\w+)>/g), (match) => match[1]).sort();
}
