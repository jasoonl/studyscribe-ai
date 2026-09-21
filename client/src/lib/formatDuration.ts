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
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "Unknown";

  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  const remainingSeconds = whole % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
