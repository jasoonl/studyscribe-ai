/**
 * Per-browser display preferences. Storage can be unavailable (private
 * windows, blocked site data), so every read falls back to the default.
 */
const AUTO_NOTES_KEY = "studyscribe_auto_notes";

export function getAutoNotesEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_NOTES_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoNotesEnabled(enabled: boolean) {
  try {
    localStorage.setItem(AUTO_NOTES_KEY, enabled ? "on" : "off");
  } catch {
    // Preference just won't persist.
  }
}

/** Auto notes are attempted once per recording per tab, so a failure never loops. */
export function claimAutoNotesAttempt(recordingId: number): boolean {
  const key = `studyscribe_auto_notes_tried_${recordingId}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}
