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

const NOTE_TEMPLATE_KEY = "studyscribe_note_template";

/** The template picked as default in the gallery, per audience ("student" for classes, "professional" for meetings). */
export function getPreferredNoteTemplate(audience: "student" | "professional"): string | null {
  try {
    return localStorage.getItem(`${NOTE_TEMPLATE_KEY}_${audience}`);
  } catch {
    return null;
  }
}

export function setPreferredNoteTemplate(audience: "student" | "professional", templateId: string) {
  try {
    localStorage.setItem(`${NOTE_TEMPLATE_KEY}_${audience}`, templateId);
  } catch {
    // Preference just won't persist.
  }
}

const LIVE_TRANSCRIPT_KEY = "studyscribe_live_transcript";

/** Live text while recording is opt-in: the streaming service bills every minute it runs. */
export function getLiveTranscriptEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_TRANSCRIPT_KEY) === "on";
  } catch {
    return false;
  }
}

export function setLiveTranscriptEnabled(enabled: boolean) {
  try {
    localStorage.setItem(LIVE_TRANSCRIPT_KEY, enabled ? "on" : "off");
  } catch {
    // Preference just won't persist.
  }
}

const CAPTION_SIZE_KEY = "studyscribe_caption_size";

/** Live captions text size step (an index into the captions view's sizes). */
export function getCaptionSize(fallback: number): number {
  try {
    const stored = localStorage.getItem(CAPTION_SIZE_KEY);
    const value = stored === null ? NaN : Number(stored);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function setCaptionSize(step: number) {
  try {
    localStorage.setItem(CAPTION_SIZE_KEY, String(step));
  } catch {
    // Preference just won't persist.
  }
}

const SKIP_SILENCE_KEY = "studyscribe_skip_silence";

/** "Skip silence" in the audio player is opt-in and remembered per browser. */
export function getSkipSilenceEnabled(): boolean {
  try {
    return localStorage.getItem(SKIP_SILENCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSkipSilenceEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SKIP_SILENCE_KEY, enabled ? "on" : "off");
  } catch {
    // Preference just won't persist.
  }
}
