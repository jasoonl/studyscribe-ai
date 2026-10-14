import { elapsedSeconds, formatClock, initialRecorderState, isLive, recorderReducer, recoverFromJournal, type RecorderEvent, type RecorderState } from "./machine";

const T0 = 1_000_000;
const run = (events: RecorderEvent[], state: RecorderState = initialRecorderState) => events.reduce(recorderReducer, state);
const start: RecorderEvent = { type: "START", now: T0, sessionId: "s1", fileUri: "file:///doc/recordings/a.aac" };

describe("recorder state machine", () => {
  it("counts elapsed time from timestamps, excluding pauses", () => {
    const state = run([start, { type: "PAUSE", now: T0 + 60_000 }, { type: "RESUME", now: T0 + 90_000 }]);
    expect(state.phase).toBe("recording");
    // 60s before the pause, 15s after resuming; the 30s pause does not count.
    expect(elapsedSeconds(state, T0 + 105_000)).toBe(75);
  });

  it("keeps counting while JS timers are asleep (screen locked), because time is read, not ticked", () => {
    const state = run([start]);
    expect(elapsedSeconds(state, T0 + 3_600_000)).toBe(3600);
  });

  it("records an interruption as a pause with its reason", () => {
    const state = run([start, { type: "PAUSE", now: T0 + 5000, reason: "interrupted" }]);
    expect(state).toMatchObject({ phase: "paused", reason: "interrupted", elapsedMs: 5000 });
    expect(isLive(state)).toBe(true);
  });

  it("marks moments, collapsing double taps and allowing marks while paused", () => {
    const state = run([
      start,
      { type: "MARK", now: T0 + 10_000 },
      { type: "MARK", now: T0 + 10_900 },
      { type: "MARK", now: T0 + 30_000 },
      { type: "PAUSE", now: T0 + 40_000 },
      { type: "MARK", now: T0 + 50_000 },
    ]);
    expect(state.phase !== "idle" && state.bookmarks).toEqual([{ atSeconds: 10 }, { atSeconds: 30 }, { atSeconds: 40 }]);
  });

  it("stops with the final duration and file, then uploads and submits", () => {
    let state = run([start, { type: "STOP", now: T0 + 125_000, uri: "file:///doc/recordings/s1.aac" }]);
    expect(state).toMatchObject({ phase: "stopped", uri: "file:///doc/recordings/s1.aac", elapsedMs: 125_000 });
    expect(elapsedSeconds(state, T0 + 999_999)).toBe(125);
    state = run([{ type: "UPLOAD_START" }, { type: "UPLOAD_PROGRESS", progress: 0.4 }, { type: "UPLOAD_PROGRESS", progress: 0.2 }], state);
    expect(state).toMatchObject({ phase: "uploading", progress: 0.4 });
    state = recorderReducer(state, { type: "SUBMITTED", recordingId: 42 });
    expect(state).toMatchObject({ phase: "submitted", recordingId: 42 });
  });

  it("keeps the audio after a failed upload so it can be retried", () => {
    const state = run([start, { type: "STOP", now: T0 + 1000, uri: "u" }, { type: "UPLOAD_START" }, { type: "FAILED", error: "Offline" }]);
    expect(state).toMatchObject({ phase: "failed", uri: "u", error: "Offline" });
    expect(recorderReducer(state, { type: "UPLOAD_START" }).phase).toBe("uploading");
  });

  it("ignores events that make no sense in the current phase", () => {
    expect(recorderReducer(initialRecorderState, { type: "PAUSE", now: T0 })).toBe(initialRecorderState);
    expect(recorderReducer(initialRecorderState, { type: "STOP", now: T0, uri: "u" })).toBe(initialRecorderState);
    const recording = run([start]);
    expect(recorderReducer(recording, { type: "START", now: T0 + 5, sessionId: "s2" })).toBe(recording);
    expect(recorderReducer(recording, { type: "RESUME", now: T0 + 5 })).toBe(recording);
    expect(recorderReducer(recording, { type: "UPLOAD_START" })).toBe(recording);
  });

  it("resets to idle (discard)", () => {
    expect(recorderReducer(run([start]), { type: "RESET" })).toEqual(initialRecorderState);
  });

  it("formats the clock", () => {
    expect(formatClock(5)).toBe("00:05");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3723)).toBe("1:02:03");
  });
});

describe("crash recovery", () => {
  const exists = () => true;

  it("offers back a session that was recording when the app died, up to the last journal write", () => {
    const state = run([start, { type: "FILE", uri: "file:///doc/recordings/a.aac" }]);
    const recovered = recoverFromJournal({ state, savedAt: T0 + 600_000 }, exists);
    expect(recovered).toMatchObject({ phase: "stopped", uri: "file:///doc/recordings/a.aac", elapsedMs: 600_000 });
  });

  it("offers back a paused session with its recorded time", () => {
    const state = run([start, { type: "PAUSE", now: T0 + 30_000 }]);
    expect(recoverFromJournal({ state, savedAt: T0 + 900_000 }, exists)).toMatchObject({ phase: "stopped", elapsedMs: 30_000 });
  });

  it("turns an interrupted upload back into a stopped recording, keeps bookmarks", () => {
    const state = run([start, { type: "MARK", now: T0 + 20_000 }, { type: "STOP", now: T0 + 60_000, uri: "u" }, { type: "UPLOAD_START" }]);
    const recovered = recoverFromJournal({ state, savedAt: T0 + 70_000 }, exists);
    expect(recovered).toMatchObject({ phase: "stopped", uri: "u", bookmarks: [{ atSeconds: 20 }] });
  });

  it("offers nothing when the audio file is gone, nothing was recording, or it was already sent", () => {
    const state = run([start]);
    expect(recoverFromJournal({ state, savedAt: T0 }, () => false)).toBeNull();
    expect(recoverFromJournal(null, exists)).toBeNull();
    expect(recoverFromJournal({ state: initialRecorderState, savedAt: T0 }, exists)).toBeNull();
    const sent = run([start, { type: "STOP", now: T0 + 1, uri: "u" }, { type: "UPLOAD_START" }, { type: "SUBMITTED", recordingId: 1 }]);
    expect(recoverFromJournal({ state: sent, savedAt: T0 }, exists)).toBeNull();
  });
});
