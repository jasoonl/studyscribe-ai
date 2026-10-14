/**
 * The recorder's state, as a pure reducer so every transition is tested.
 *
 * Elapsed time comes from timestamps (as on the web, client/src/lib/
 * recordingClock.ts), never from a ticking counter: JS timers stop while the
 * phone is locked, but the native recorder keeps going, and the elapsed time
 * becomes the recording's duration.
 *
 *   idle -> recording <-> paused -> stopped -> uploading -> submitted
 *                                      \             \-> failed -> uploading (retry)
 *                                       \-> idle (discard)
 *
 * `interrupted` is a pause the system caused (a phone call, another app
 * taking the microphone); the person resumes it like any pause.
 */

export type Bookmark = { atSeconds: number };

export type RecorderState =
  | { phase: "idle" }
  | Session<"recording", { runningSince: number }>
  | Session<"paused", { reason: "user" | "interrupted" }>
  | Session<"stopped", { uri: string }>
  | Session<"uploading", { uri: string; progress: number }>
  | Session<"submitted", { uri: string; recordingId: number }>
  | Session<"failed", { uri: string; error: string }>;

type Session<P extends string, Extra> = {
  phase: P;
  sessionId: string;
  startedAt: number;
  /** Time recorded before the current run (sum of finished runs). */
  elapsedMs: number;
  bookmarks: Bookmark[];
  /** Where the native recorder is writing; known from the first status update. */
  fileUri: string | null;
} & Extra;

export type RecorderEvent =
  | { type: "START"; now: number; sessionId: string; fileUri?: string | null }
  | { type: "FILE"; uri: string }
  | { type: "PAUSE"; now: number; reason?: "user" | "interrupted" }
  | { type: "RESUME"; now: number }
  | { type: "MARK"; now: number }
  | { type: "STOP"; now: number; uri: string }
  | { type: "UPLOAD_START" }
  | { type: "UPLOAD_PROGRESS"; progress: number }
  | { type: "SUBMITTED"; recordingId: number }
  | { type: "FAILED"; error: string }
  | { type: "RESET" }
  | { type: "RESTORE"; state: RecorderState };

export const initialRecorderState: RecorderState = { phase: "idle" };

/** Seconds recorded so far, at `now`. */
export function elapsedSeconds(state: RecorderState, now: number): number {
  if (state.phase === "idle") return 0;
  const running = state.phase === "recording" ? Math.max(0, now - state.runningSince) : 0;
  return Math.floor((state.elapsedMs + running) / 1000);
}

/** Marks closer together than this collapse into one (a double tap is one moment). */
const MIN_BOOKMARK_GAP_SECONDS = 2;
export const MAX_BOOKMARKS = 200;

function session(state: RecorderState) {
  if (state.phase === "idle") return null;
  const { sessionId, startedAt, elapsedMs, bookmarks, fileUri } = state;
  return { sessionId, startedAt, elapsedMs, bookmarks, fileUri };
}

export function recorderReducer(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case "START":
      if (state.phase !== "idle") return state;
      return { phase: "recording", sessionId: event.sessionId, startedAt: event.now, elapsedMs: 0, bookmarks: [], fileUri: event.fileUri ?? null, runningSince: event.now };

    case "FILE":
      if (state.phase === "idle" || state.fileUri === event.uri) return state;
      return { ...state, fileUri: event.uri };

    case "PAUSE":
      if (state.phase !== "recording") return state;
      return { ...session(state)!, phase: "paused", reason: event.reason ?? "user", elapsedMs: state.elapsedMs + Math.max(0, event.now - state.runningSince) };

    case "RESUME":
      if (state.phase !== "paused") return state;
      return { ...session(state)!, phase: "recording", runningSince: event.now };

    case "MARK": {
      if (state.phase !== "recording" && state.phase !== "paused") return state;
      const at = elapsedSeconds(state, event.now);
      const last = state.bookmarks[state.bookmarks.length - 1];
      if ((last && at - last.atSeconds < MIN_BOOKMARK_GAP_SECONDS) || state.bookmarks.length >= MAX_BOOKMARKS) return state;
      return { ...state, bookmarks: [...state.bookmarks, { atSeconds: at }] };
    }

    case "STOP": {
      if (state.phase !== "recording" && state.phase !== "paused") return state;
      const elapsedMs = state.phase === "recording" ? state.elapsedMs + Math.max(0, event.now - state.runningSince) : state.elapsedMs;
      return { ...session(state)!, phase: "stopped", elapsedMs, fileUri: event.uri, uri: event.uri };
    }

    case "UPLOAD_START":
      if (state.phase !== "stopped" && state.phase !== "failed") return state;
      return { ...session(state)!, phase: "uploading", uri: state.uri, progress: 0 };

    case "UPLOAD_PROGRESS":
      if (state.phase !== "uploading") return state;
      return { ...state, progress: Math.max(state.progress, Math.min(1, event.progress)) };

    case "SUBMITTED":
      if (state.phase !== "uploading") return state;
      return { ...session(state)!, phase: "submitted", uri: state.uri, recordingId: event.recordingId };

    case "FAILED":
      if (state.phase !== "uploading") return state;
      return { ...session(state)!, phase: "failed", uri: state.uri, error: event.error };

    case "RESET":
      return initialRecorderState;

    case "RESTORE":
      return state.phase === "idle" ? event.state : state;
  }
}

/** Whether the microphone is in use (recording or paused mid-session). */
export function isLive(state: RecorderState) {
  return state.phase === "recording" || state.phase === "paused";
}

/** A crashed or killed session found at launch: the audio on disk is offered back as a stopped recording. */
export type Journal = { state: RecorderState; savedAt: number };

/**
 * A session found on disk at launch (the app crashed, was killed, or the
 * phone restarted mid-lecture): the audio written so far is offered back as a
 * stopped recording. A session that was still running counts up to the last
 * journal write, which happens every few seconds while recording.
 */
export function recoverFromJournal(journal: Journal | null, fileExists: (uri: string) => boolean): RecorderState | null {
  const state = journal?.state;
  if (!state || state.phase === "idle" || state.phase === "submitted") return null;
  const uri = state.phase === "recording" || state.phase === "paused" ? state.fileUri : state.uri;
  if (!uri || !fileExists(uri)) return null;
  if (state.phase === "failed" || state.phase === "stopped") return state;
  // An upload cut off by the crash goes back to "stopped" so it can be sent again.
  const running = state.phase === "recording" ? Math.max(0, journal!.savedAt - state.runningSince) : 0;
  const { sessionId, startedAt, bookmarks } = state;
  return { phase: "stopped", sessionId, startedAt, bookmarks, elapsedMs: state.elapsedMs + running, fileUri: uri, uri };
}

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
