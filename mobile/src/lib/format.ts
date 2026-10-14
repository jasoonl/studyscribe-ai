/** Same rule as the web (client/src/lib/formatDuration.ts): 0 or missing means "Unknown". */
export function formatRecordingDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "Unknown";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const remainingSeconds = whole % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** m:ss or h:mm:ss for transcript timestamps and the player. */
export function formatTimestamp(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Recording, 13 Oct 2:05 PM" style default title for a new recording. */
export function defaultRecordingTitle(now = new Date()) {
  const day = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Recording ${day}, ${time}`;
}
