/** "4:05" or "1:02:09", the way the web recorder shows elapsed time. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The toolbar badge holds about four characters: "0:42", "12m", "1h05". */
export function badgeText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 600) return formatElapsed(s);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const hours = Math.floor(s / 3600);
  if (hours > 9) return `${hours}h`;
  return `${hours}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function formatRecordedDate(value: Date | string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function statusLabel(status: string | null | undefined): string {
  if (status === "completed") return "Ready";
  if (status === "failed") return "Needs attention";
  return "Transcribing";
}

/** A default title from the tab's title, trimmed to what the server stores. */
export function defaultTitle(tabTitle: string | undefined, now = new Date()): string {
  const cleaned = (tabTitle ?? "").replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.slice(0, 200);
  return `Tab recording, ${now.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
