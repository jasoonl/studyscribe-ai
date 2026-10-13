import { describe, expect, it } from "vitest";
import { applyRecorderEvent, isFromThisExtension, isOffscreenCommand, isPopupMessage, isRecorderEvent, parseMessage, type RecorderState } from "./messages";

describe("parseMessage", () => {
  it("accepts every well-formed message", () => {
    const messages = [
      { type: "state" },
      { type: "record:start", tabId: 7, tabTitle: "Lecture", title: "Lecture 4", withMic: true, language: "es" },
      { type: "record:stop" },
      { type: "record:discard" },
      { type: "import:start", url: "https://example.com/a.mp3" },
      { type: "import:clear" },
      { type: "offscreen:start", streamId: "abc", withMic: false, origin: "https://x.dev", save: { title: "T" } },
      { type: "offscreen:stop" },
      { type: "offscreen:discard" },
      { type: "recorder:started", micIncluded: false },
      { type: "recorder:tick", elapsedSeconds: 12 },
      { type: "recorder:progress", percent: 40 },
      { type: "recorder:saved", recording: { id: 3, title: "T" } },
      { type: "recorder:failed", message: "No audio" },
    ];
    for (const message of messages) expect(parseMessage(message)).toEqual(message);
  });

  it("drops unknown fields instead of passing them on", () => {
    expect(parseMessage({ type: "record:stop", extra: "x" })).toEqual({ type: "record:stop" });
    expect(parseMessage({ type: "import:start", url: "https://a.b/", injected: true })).toEqual({ type: "import:start", url: "https://a.b/", title: undefined, language: undefined });
  });

  it("rejects malformed or unknown messages", () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage("state")).toBeNull();
    expect(parseMessage({ type: "nope" })).toBeNull();
    expect(parseMessage({ type: "record:start", tabId: "7", tabTitle: "x", title: "x", withMic: false })).toBeNull();
    expect(parseMessage({ type: "record:start", tabId: 7, tabTitle: "x", title: "x", withMic: "yes" })).toBeNull();
    expect(parseMessage({ type: "record:start", tabId: 7, tabTitle: "x", title: "x".repeat(300), withMic: false })).toBeNull();
    expect(parseMessage({ type: "record:start", tabId: 7, tabTitle: "x", title: "x", withMic: false, language: "en; drop" })).toBeNull();
    expect(parseMessage({ type: "import:start", url: 42 })).toBeNull();
    expect(parseMessage({ type: "recorder:tick", elapsedSeconds: -1 })).toBeNull();
    expect(parseMessage({ type: "recorder:progress", percent: 101 })).toBeNull();
    expect(parseMessage({ type: "recorder:saved", recording: { id: 0, title: "x" } })).toBeNull();
    expect(parseMessage({ type: "offscreen:start", streamId: "a", withMic: true, origin: "x", save: null })).toBeNull();
  });

  it("sorts messages by audience", () => {
    const stop = parseMessage({ type: "offscreen:stop" })!;
    const tick = parseMessage({ type: "recorder:tick", elapsedSeconds: 1 })!;
    const state = parseMessage({ type: "state" })!;
    expect([isOffscreenCommand(stop), isRecorderEvent(stop), isPopupMessage(stop)]).toEqual([true, false, false]);
    expect([isOffscreenCommand(tick), isRecorderEvent(tick), isPopupMessage(tick)]).toEqual([false, true, false]);
    expect([isOffscreenCommand(state), isRecorderEvent(state), isPopupMessage(state)]).toEqual([false, false, true]);
  });
});

describe("isFromThisExtension", () => {
  it("accepts only this extension's own pages", () => {
    expect(isFromThisExtension({ id: "abc", url: "chrome-extension://abc/popup.html" }, "abc")).toBe(true);
    expect(isFromThisExtension({ id: "abc" }, "abc")).toBe(true);
    expect(isFromThisExtension({ id: "other", url: "chrome-extension://other/popup.html" }, "abc")).toBe(false);
    expect(isFromThisExtension({ id: "abc", url: "https://evil.example/" }, "abc")).toBe(false);
    expect(isFromThisExtension(undefined, "abc")).toBe(false);
  });
});

describe("applyRecorderEvent", () => {
  const recording: RecorderState = { status: "recording", tabId: 1, tabTitle: "Tab", title: "Title", startedAt: 0, elapsedSeconds: 0, withMic: true };

  it("moves the clock only while recording", () => {
    expect(applyRecorderEvent(recording, { type: "recorder:tick", elapsedSeconds: 9 })).toMatchObject({ status: "recording", elapsedSeconds: 9 });
    const idle: RecorderState = { status: "idle" };
    expect(applyRecorderEvent(idle, { type: "recorder:tick", elapsedSeconds: 9 })).toBe(idle);
  });

  it("records whether the microphone really joined", () => {
    expect(applyRecorderEvent(recording, { type: "recorder:started", micIncluded: false })).toMatchObject({ withMic: false });
  });

  it("switches to saving on the first progress event, as when the tab is closed mid-recording", () => {
    const saving = applyRecorderEvent(recording, { type: "recorder:progress", percent: 5.4 });
    expect(saving).toEqual({ status: "saving", title: "Title", percent: 5 });
    expect(applyRecorderEvent(saving, { type: "recorder:progress", percent: 3 })).toMatchObject({ percent: 5 });
    expect(applyRecorderEvent(saving, { type: "recorder:progress", percent: 64 })).toMatchObject({ percent: 64 });
  });

  it("ends in saved or failed", () => {
    expect(applyRecorderEvent(recording, { type: "recorder:saved", recording: { id: 9, title: "T" } })).toEqual({ status: "saved", recording: { id: 9, title: "T" } });
    expect(applyRecorderEvent(recording, { type: "recorder:failed", message: "x" })).toEqual({ status: "failed", message: "x" });
  });
});
