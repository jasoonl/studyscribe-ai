import type { StudyScribeApi } from "./api";
import { ApiError } from "./api";
import { badgeText } from "./format";
import {
  applyRecorderEvent,
  type CommandResponse,
  type ExtensionMessage,
  type ImportState,
  type OffscreenCommand,
  type PopupMessage,
  type RecorderEvent,
  type RecorderState,
  type StateResponse,
} from "./messages";
import { checkImportableUrl } from "./origin";

/**
 * The service worker's logic, with every Chrome API passed in so it can be
 * tested without a browser. `background.ts` supplies the real ones.
 */
export type WorkerDeps = {
  getOrigin: () => Promise<string>;
  api: (origin: string) => Pick<StudyScribeApi, "createFromUrl">;
  load: () => Promise<Partial<StateResponse>>;
  save: (state: StateResponse) => Promise<void>;
  getTabStreamId: (tabId: number) => Promise<string>;
  ensureOffscreen: () => Promise<void>;
  closeOffscreen: () => Promise<void>;
  sendToOffscreen: (command: OffscreenCommand) => Promise<CommandResponse | undefined>;
  setBadge: (text: string, title: string) => Promise<void>;
  /** Keeps the worker alive while a long request is in flight; returns a stop function. */
  keepAlive: () => () => void;
  now: () => number;
};

const IDLE_TITLE = "StudyScribe";

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) {
    if (/not been invoked|activeTab|Cannot capture/i.test(error.message)) {
      return "Chrome did not allow recording this tab. Open StudyScribe from the toolbar on the tab you want to record and try again.";
    }
    if (/Chrome pages cannot be captured|chrome:\/\//i.test(error.message)) {
      return "Chrome's own pages cannot be recorded. Switch to the tab with your lecture.";
    }
    return error.message;
  }
  return fallback;
}

export function createWorker(deps: WorkerDeps) {
  let state: StateResponse = { recorder: { status: "idle" }, importJob: { status: "idle" } };
  let loaded: Promise<void> | null = null;

  const ready = () => {
    loaded ??= deps.load().then(stored => {
      state = { recorder: stored.recorder ?? state.recorder, importJob: stored.importJob ?? state.importJob };
      // A worker restart mid-import cannot pick the request back up.
      if (state.importJob.status === "importing") {
        state.importJob = { status: "failed", message: "The import was interrupted. Check your library, then try again if it is not there." };
      }
    });
    return loaded;
  };

  async function setRecorder(recorder: RecorderState) {
    state = { ...state, recorder };
    await deps.save(state);
    if (recorder.status === "recording") {
      await deps.setBadge(badgeText(recorder.elapsedSeconds), `Recording ${recorder.tabTitle}`);
    } else if (recorder.status === "saving" || recorder.status === "starting") {
      await deps.setBadge("…", recorder.status === "saving" ? "Saving to StudyScribe" : "Starting");
    } else {
      await deps.setBadge("", IDLE_TITLE);
    }
  }

  async function setImport(importJob: ImportState) {
    state = { ...state, importJob };
    await deps.save(state);
  }

  async function startRecording(message: Extract<PopupMessage, { type: "record:start" }>): Promise<CommandResponse> {
    if (state.recorder.status === "recording" || state.recorder.status === "starting" || state.recorder.status === "saving") {
      return { ok: false, error: "A recording is already in progress." };
    }
    const origin = await deps.getOrigin();
    await setRecorder({ status: "starting", tabTitle: message.tabTitle });
    try {
      const streamId = await deps.getTabStreamId(message.tabId);
      await deps.ensureOffscreen();
      const response = await deps.sendToOffscreen({
        type: "offscreen:start",
        streamId,
        withMic: message.withMic,
        origin,
        save: { title: message.title, language: message.language },
      });
      if (!response?.ok) throw new Error(response && !response.ok ? response.error : "The recorder did not start.");
      await setRecorder({
        status: "recording",
        tabId: message.tabId,
        tabTitle: message.tabTitle,
        title: message.title,
        startedAt: deps.now(),
        elapsedSeconds: 0,
        withMic: response.micIncluded ?? message.withMic,
      });
      return { ok: true };
    } catch (error) {
      const text = describeError(error, "Recording could not start.");
      await deps.closeOffscreen().catch(() => {});
      await setRecorder({ status: "failed", message: text });
      return { ok: false, error: text };
    }
  }

  async function startImport(message: Extract<PopupMessage, { type: "import:start" }>): Promise<CommandResponse> {
    if (state.importJob.status === "importing") return { ok: false, error: "An import is already running." };
    const origin = await deps.getOrigin();
    const check = checkImportableUrl(message.url, origin);
    if (!check.ok) return { ok: false, error: check.reason };
    await setImport({ status: "importing", url: check.url, startedAt: deps.now() });
    const release = deps.keepAlive();
    // The popup may close while the server downloads the media; the worker carries on and keeps the result.
    void deps
      .api(origin)
      .createFromUrl({ url: check.url, title: message.title, language: message.language })
      .then(
        recording => setImport({ status: "imported", recording: { id: recording.id, title: recording.title } }),
        error => setImport({ status: "failed", message: describeError(error, "The page could not be imported.") }),
      )
      .finally(release);
    return { ok: true };
  }

  async function handlePopup(message: PopupMessage): Promise<StateResponse | CommandResponse> {
    switch (message.type) {
      case "state":
        return state;
      case "record:start":
        return startRecording(message);
      case "record:stop": {
        if (state.recorder.status !== "recording") return { ok: false, error: "Nothing is recording." };
        const title = state.recorder.title;
        await setRecorder({ status: "saving", title, percent: 0 });
        const response = await deps.sendToOffscreen({ type: "offscreen:stop" }).catch(() => undefined);
        if (!response?.ok) {
          const text = response && !response.ok ? response.error : "The recorder stopped unexpectedly, so the recording was lost.";
          await setRecorder({ status: "failed", message: text });
          await deps.closeOffscreen().catch(() => {});
          return { ok: false, error: text };
        }
        return { ok: true };
      }
      case "record:discard": {
        if (state.recorder.status === "recording" || state.recorder.status === "starting") {
          await deps.sendToOffscreen({ type: "offscreen:discard" }).catch(() => undefined);
          await deps.closeOffscreen().catch(() => {});
        }
        if (state.recorder.status === "saving") return { ok: false, error: "The recording is being saved." };
        await setRecorder({ status: "idle" });
        return { ok: true };
      }
      case "import:start":
        return startImport(message);
      case "import:clear":
        if (state.importJob.status !== "importing") await setImport({ status: "idle" });
        return { ok: true };
    }
  }

  async function handleRecorderEvent(event: RecorderEvent): Promise<CommandResponse> {
    const next = applyRecorderEvent(state.recorder, event);
    if (next !== state.recorder) await setRecorder(next);
    if (event.type === "recorder:saved" || event.type === "recorder:failed") {
      await deps.closeOffscreen().catch(() => {});
    }
    return { ok: true };
  }

  return {
    get state() {
      return state;
    },
    async handle(message: ExtensionMessage): Promise<StateResponse | CommandResponse | undefined> {
      await ready();
      if (message.type.startsWith("offscreen:")) return undefined; // Addressed to the recorder, not the worker.
      if (message.type.startsWith("recorder:")) return handleRecorderEvent(message as RecorderEvent);
      return handlePopup(message as PopupMessage);
    },
  };
}
