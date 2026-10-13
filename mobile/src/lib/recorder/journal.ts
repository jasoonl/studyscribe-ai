import { Directory, File, Paths } from "expo-file-system";
import type { Journal, RecorderState } from "./machine";

/**
 * The recorder's crash journal: the session state written next to the audio
 * in the app's document directory (never the cache, which the system may
 * clear) every few seconds while recording and on every transition. The
 * recorder itself writes ADTS AAC, where every frame stands alone, so the
 * audio on disk stays playable even if the app dies mid-sentence.
 */

export const RECORDINGS_DIR = "recordings";

function journalFile() {
  return new File(Paths.document, RECORDINGS_DIR, "session.json");
}

export function ensureRecordingsDir() {
  const dir = new Directory(Paths.document, RECORDINGS_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function writeJournal(state: RecorderState, now = Date.now()) {
  try {
    ensureRecordingsDir();
    const file = journalFile();
    if (state.phase === "idle") {
      if (file.exists) file.delete();
      return;
    }
    const journal: Journal = { state, savedAt: now };
    file.write(JSON.stringify(journal));
  } catch (error) {
    console.warn("[Recorder] could not write the journal", error);
  }
}

export function readJournal(): Journal | null {
  try {
    const file = journalFile();
    if (!file.exists) return null;
    return JSON.parse(file.textSync()) as Journal;
  } catch {
    return null;
  }
}

export function fileExists(uri: string) {
  try {
    const file = new File(uri);
    return file.exists && (file.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Moves a finished recording into the recordings folder so it survives until it has been uploaded. */
export function keepRecording(uri: string, sessionId: string): string {
  try {
    const source = new File(uri);
    const dir = ensureRecordingsDir();
    if (source.parentDirectory?.uri === dir.uri) return uri;
    const extension = uri.split(".").pop() || "aac";
    const target = new File(dir, `${sessionId}.${extension}`);
    source.move(target);
    return target.uri;
  } catch {
    return uri;
  }
}

/** Deletes the local copy once the server has it. */
export function deleteRecordingFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}
