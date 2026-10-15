import { t } from "@/i18n";

/**
 * Formats a recording's stored duration (whole seconds) for display.
 *
 * Rounding straight to whole minutes made any recording under 60 seconds —
 * exactly what a quick test recording is — read as "0 minutes", which looks
 * identical to a broken/empty recording. Anything with no duration at all
 * (uploads and link imports never had their real length measured) shows
 * "Unknown" instead of the more alarming "N/A".
 */
export function formatRecordingDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return t("duration.unknown");

  const whole = Math.round(seconds);
  if (whole < 60) return t("duration.seconds", { s: whole });

  const minutes = Math.floor(whole / 60);
  const remainingSeconds = whole % 60;
  if (minutes < 60) return t("duration.minutes", { m: minutes, s: remainingSeconds });

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return t("duration.hours", { h: hours, m: remainingMinutes });
}
