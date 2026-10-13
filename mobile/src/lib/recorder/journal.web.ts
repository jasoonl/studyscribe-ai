import type { Journal, RecorderState } from "./machine";

/** Web preview: the journal lives in localStorage; recorded audio is a blob: URL that does not survive a reload. */
const KEY = "studyscribe.recorder.journal";

export const RECORDINGS_DIR = "recordings";

export function ensureRecordingsDir() {
  return null;
}

export function writeJournal(state: RecorderState, now = Date.now()) {
  try {
    if (state.phase === "idle") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ state, savedAt: now } satisfies Journal));
  } catch {
    // Storage blocked.
  }
}

export function readJournal(): Journal | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Journal) : null;
  } catch {
    return null;
  }
}

export function fileExists(_uri: string) {
  return false;
}

export function keepRecording(uri: string, _sessionId: string) {
  return uri;
}

export function deleteRecordingFile(_uri: string) {}
