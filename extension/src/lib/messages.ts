/**
 * Messages between the popup, the service worker and the offscreen recorder.
 *
 * popup -> worker: "state", "record:start", "record:stop", "record:discard",
 *                  "import:start", "import:clear"
 * worker -> offscreen: "offscreen:start", "offscreen:stop", "offscreen:discard"
 * offscreen -> worker: "recorder:started", "recorder:tick", "recorder:progress",
 *                      "recorder:saved", "recorder:failed"
 *
 * Every message is checked with `parseMessage` before it is acted on, and
 * messages from anywhere but this extension are ignored (`isFromThisExtension`).
 */

export type SavedRecording = { id: number; title: string };

export type RecorderState =
  | { status: "idle" }
  | { status: "starting"; tabTitle: string }
  | { status: "recording"; tabId: number; tabTitle: string; title: string; startedAt: number; elapsedSeconds: number; withMic: boolean }
  | { status: "saving"; title: string; percent: number }
  | { status: "saved"; recording: SavedRecording }
  | { status: "failed"; message: string };

export type ImportState =
  | { status: "idle" }
  | { status: "importing"; url: string; startedAt: number }
  | { status: "imported"; recording: SavedRecording }
  | { status: "failed"; message: string };

export type SaveOptions = { title: string; language?: string };

export type PopupMessage =
  | { type: "state" }
  | { type: "record:start"; tabId: number; tabTitle: string; title: string; withMic: boolean; language?: string }
  | { type: "record:stop" }
  | { type: "record:discard" }
  | { type: "import:start"; url: string; title?: string; language?: string }
  | { type: "import:clear" };

/**
 * The offscreen recorder is told where to save when it starts, so a recording
 * still reaches StudyScribe when it ends on its own (the tab was closed).
 */
export type OffscreenCommand =
  | { type: "offscreen:start"; streamId: string; withMic: boolean; origin: string; save: SaveOptions }
  | { type: "offscreen:stop" }
  | { type: "offscreen:discard" };

export type RecorderEvent =
  | { type: "recorder:started"; micIncluded: boolean }
  | { type: "recorder:tick"; elapsedSeconds: number }
  | { type: "recorder:progress"; percent: number }
  | { type: "recorder:saved"; recording: SavedRecording }
  | { type: "recorder:failed"; message: string };

export type ExtensionMessage = PopupMessage | OffscreenCommand | RecorderEvent;

export type StateResponse = { recorder: RecorderState; importJob: ImportState };
/** `micIncluded` answers "offscreen:start": false when the microphone was asked for but not available. */
export type CommandResponse = { ok: true; micIncluded?: boolean } | { ok: false; error: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isString = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length <= max;
const isOptionalString = (value: unknown, max = 4096) => value === undefined || isString(value, max);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isLanguage = (value: unknown) => value === undefined || (typeof value === "string" && /^[a-z]{2,3}(_[a-z]{2})?$/i.test(value));
const isSaved = (value: unknown): value is SavedRecording =>
  isObject(value) && Number.isInteger(value.id) && (value.id as number) > 0 && isString(value.title, 255);

/** Returns the message if it has a known type and well-formed fields, otherwise null. */
export function parseMessage(value: unknown): ExtensionMessage | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  const m = value;
  switch (m.type) {
    case "state":
    case "record:stop":
    case "record:discard":
    case "import:clear":
    case "offscreen:discard":
      return { type: m.type } as ExtensionMessage;
    case "record:start":
      if (!Number.isInteger(m.tabId) || !isString(m.tabTitle, 1000) || !isString(m.title, 255) || typeof m.withMic !== "boolean" || !isLanguage(m.language)) return null;
      return { type: m.type, tabId: m.tabId as number, tabTitle: m.tabTitle, title: m.title, withMic: m.withMic, language: m.language as string | undefined };
    case "import:start":
      if (!isString(m.url, 2048) || !isOptionalString(m.title, 255) || !isLanguage(m.language)) return null;
      return { type: m.type, url: m.url, title: m.title as string | undefined, language: m.language as string | undefined };
    case "offscreen:start": {
      const save = m.save;
      if (!isString(m.streamId, 512) || typeof m.withMic !== "boolean" || !isString(m.origin, 512)) return null;
      if (!isObject(save) || !isString(save.title, 255) || !isLanguage(save.language)) return null;
      return {
        type: m.type,
        streamId: m.streamId,
        withMic: m.withMic,
        origin: m.origin,
        save: { title: save.title, language: save.language as string | undefined },
      };
    }
    case "offscreen:stop":
      return { type: m.type };
    case "recorder:started":
      if (typeof m.micIncluded !== "boolean") return null;
      return { type: m.type, micIncluded: m.micIncluded };
    case "recorder:tick":
      if (!isCount(m.elapsedSeconds)) return null;
      return { type: m.type, elapsedSeconds: m.elapsedSeconds };
    case "recorder:progress":
      if (!isCount(m.percent) || m.percent > 100) return null;
      return { type: m.type, percent: m.percent };
    case "recorder:saved":
      if (!isSaved(m.recording)) return null;
      return { type: m.type, recording: { id: m.recording.id, title: m.recording.title } };
    case "recorder:failed":
      if (!isString(m.message, 2000)) return null;
      return { type: m.type, message: m.message };
    default:
      return null;
  }
}

/** Messages addressed to the offscreen document. */
export function isOffscreenCommand(message: ExtensionMessage): message is OffscreenCommand {
  return message.type.startsWith("offscreen:");
}

export function isRecorderEvent(message: ExtensionMessage): message is RecorderEvent {
  return message.type.startsWith("recorder:");
}

export function isPopupMessage(message: ExtensionMessage): message is PopupMessage {
  return !isOffscreenCommand(message) && !isRecorderEvent(message);
}

/**
 * Only this extension's own pages may drive it. Content scripts are not used,
 * and web pages cannot message it (no `externally_connectable`), but the check
 * keeps that true if either ever changes.
 */
export function isFromThisExtension(sender: { id?: string; url?: string } | undefined, extensionId: string): boolean {
  if (!sender || sender.id !== extensionId) return false;
  if (!sender.url) return true;
  return sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

/** The worker's state after a recorder event. Pure, so the transitions can be tested. */
export function applyRecorderEvent(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case "recorder:started":
      if (state.status !== "recording") return state;
      return { ...state, withMic: event.micIncluded };
    case "recorder:tick":
      if (state.status !== "recording") return state;
      return { ...state, elapsedSeconds: event.elapsedSeconds };
    case "recorder:progress":
      if (state.status === "saving") return { ...state, percent: Math.max(state.percent, Math.round(event.percent)) };
      if (state.status === "recording") return { status: "saving", title: state.title, percent: Math.round(event.percent) };
      return state;
    case "recorder:saved":
      return { status: "saved", recording: event.recording };
    case "recorder:failed":
      return { status: "failed", message: event.message };
  }
}
