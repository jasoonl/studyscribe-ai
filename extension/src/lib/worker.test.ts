import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { CommandResponse, OffscreenCommand, StateResponse } from "./messages";
import { createWorker, type WorkerDeps } from "./worker";

function setup(overrides: Partial<WorkerDeps> = {}) {
  const sent: OffscreenCommand[] = [];
  const badges: string[] = [];
  let saved: StateResponse | undefined;
  let release = vi.fn();
  const deps: WorkerDeps = {
    getOrigin: async () => "http://localhost:3107",
    api: () => ({ createFromUrl: async input => ({ id: 41, title: input.title ?? "Imported" }) }),
    load: async () => ({}),
    save: async state => {
      saved = state;
    },
    getTabStreamId: async tabId => `stream-${tabId}`,
    ensureOffscreen: vi.fn(async () => {}),
    closeOffscreen: vi.fn(async () => {}),
    sendToOffscreen: async (command): Promise<CommandResponse> => {
      sent.push(command);
      return command.type === "offscreen:start" ? { ok: true, micIncluded: command.withMic } : { ok: true };
    },
    setBadge: async text => {
      badges.push(text);
    },
    keepAlive: () => {
      release = vi.fn();
      return release;
    },
    now: () => 1_000,
    ...overrides,
  };
  return { worker: createWorker(deps), deps, sent, badges, saved: () => saved, release: () => release };
}

const startMessage = { type: "record:start" as const, tabId: 5, tabTitle: "Biology 101", title: "Cells", withMic: true, language: "en" };

describe("service worker: recording", () => {
  it("captures the tab, starts the offscreen recorder with where to save, and shows a badge", async () => {
    const { worker, deps, sent, badges, saved } = setup();
    await expect(worker.handle(startMessage)).resolves.toEqual({ ok: true });
    expect(deps.ensureOffscreen).toHaveBeenCalled();
    expect(sent[0]).toEqual({ type: "offscreen:start", streamId: "stream-5", withMic: true, origin: "http://localhost:3107", save: { title: "Cells", language: "en" } });
    expect(worker.state.recorder).toMatchObject({ status: "recording", tabId: 5, title: "Cells", startedAt: 1_000, withMic: true });
    expect(saved()?.recorder.status).toBe("recording");
    expect(badges.at(-1)).toBe("0:00");
  });

  it("refuses a second recording", async () => {
    const { worker } = setup();
    await worker.handle(startMessage);
    await expect(worker.handle(startMessage)).resolves.toEqual({ ok: false, error: "A recording is already in progress." });
  });

  it("updates the badge from ticks and reports the saved recording", async () => {
    const { worker, deps, badges } = setup();
    await worker.handle(startMessage);
    await worker.handle({ type: "recorder:tick", elapsedSeconds: 754 });
    expect(badges.at(-1)).toBe("12m");
    await expect(worker.handle({ type: "record:stop" })).resolves.toEqual({ ok: true });
    expect(worker.state.recorder).toEqual({ status: "saving", title: "Cells", percent: 0 });
    await worker.handle({ type: "recorder:progress", percent: 50 });
    expect(worker.state.recorder).toMatchObject({ percent: 50 });
    await worker.handle({ type: "recorder:saved", recording: { id: 77, title: "Cells" } });
    expect(worker.state.recorder).toEqual({ status: "saved", recording: { id: 77, title: "Cells" } });
    expect(badges.at(-1)).toBe("");
    expect(deps.closeOffscreen).toHaveBeenCalled();
  });

  it("explains a capture refusal and cleans up", async () => {
    const { worker, deps } = setup({
      getTabStreamId: async () => {
        throw new Error("Extension has not been invoked for the current page (see activeTab permission).");
      },
    });
    const response = await worker.handle(startMessage);
    expect(response).toMatchObject({ ok: false });
    expect((response as { error: string }).error).toMatch(/did not allow recording this tab/);
    expect(worker.state.recorder.status).toBe("failed");
    expect(deps.closeOffscreen).toHaveBeenCalled();
  });

  it("fails cleanly when the recorder cannot open the stream", async () => {
    const { worker } = setup({ sendToOffscreen: async () => ({ ok: false, error: "Permission denied" }) });
    await expect(worker.handle(startMessage)).resolves.toEqual({ ok: false, error: "Permission denied" });
  });

  it("discards a recording", async () => {
    const { worker, sent } = setup();
    await worker.handle(startMessage);
    await worker.handle({ type: "record:discard" });
    expect(sent.at(-1)).toEqual({ type: "offscreen:discard" });
    expect(worker.state.recorder).toEqual({ status: "idle" });
  });

  it("ignores commands addressed to the offscreen document", async () => {
    const { worker } = setup();
    await expect(worker.handle({ type: "offscreen:stop" })).resolves.toBeUndefined();
  });
});

describe("service worker: import", () => {
  it("imports in the background and keeps the worker alive until the server answers", async () => {
    let resolve!: (value: { id: number; title: string }) => void;
    const createFromUrl = vi.fn(() => new Promise<{ id: number; title: string }>(r => (resolve = r)));
    const { worker, release } = setup({ api: () => ({ createFromUrl }) });
    await expect(worker.handle({ type: "import:start", url: "https://example.com/talk.mp3", language: "fr" })).resolves.toEqual({ ok: true });
    expect(createFromUrl).toHaveBeenCalledWith({ url: "https://example.com/talk.mp3", title: undefined, language: "fr" });
    expect(worker.state.importJob).toMatchObject({ status: "importing" });
    await expect(worker.handle({ type: "import:start", url: "https://example.com/other.mp3" })).resolves.toEqual({ ok: false, error: "An import is already running." });
    resolve({ id: 9, title: "Talk" });
    await vi.waitFor(() => expect(worker.state.importJob).toEqual({ status: "imported", recording: { id: 9, title: "Talk" } }));
    expect(release()).toHaveBeenCalled();
  });

  it("refuses pages that cannot be imported without calling the server", async () => {
    const createFromUrl = vi.fn();
    const { worker } = setup({ api: () => ({ createFromUrl }) });
    await expect(worker.handle({ type: "import:start", url: "chrome://settings" })).resolves.toMatchObject({ ok: false });
    await expect(worker.handle({ type: "import:start", url: "http://localhost:3107/dashboard" })).resolves.toMatchObject({ ok: false });
    expect(createFromUrl).not.toHaveBeenCalled();
  });

  it("shows the server's explanation when an import fails", async () => {
    const { worker } = setup({
      api: () => ({
        createFromUrl: async () => {
          throw new ApiError("This link points to a private network address.", 400, "BAD_REQUEST");
        },
      }),
    });
    await worker.handle({ type: "import:start", url: "https://example.com/a" });
    await vi.waitFor(() => expect(worker.state.importJob).toEqual({ status: "failed", message: "This link points to a private network address." }));
  });

  it("marks an import interrupted by a worker restart as failed", async () => {
    const { worker } = setup({ load: async () => ({ importJob: { status: "importing", url: "https://a.b/", startedAt: 1 } }) });
    const state = (await worker.handle({ type: "state" })) as StateResponse;
    expect(state.importJob.status).toBe("failed");
  });
});
