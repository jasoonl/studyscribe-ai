import { getUiLanguage } from "@/i18n";
import { htmlLangFor } from "@shared/i18n";

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 days ago" or "in 5 minutes" in the interface language. */
export function relativeTime(value: string | number | Date, now = Date.now()) {
  const format = new Intl.RelativeTimeFormat(htmlLangFor(getUiLanguage()), { numeric: "auto" });
  const seconds = (new Date(value).getTime() - now) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}
