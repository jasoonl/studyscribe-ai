import { SOURCE_LIMITS } from "./model";
import {
  UploadAbortedError,
  cancelPlan,
  createUploadQueue,
  doneParts,
  effectiveSize,
  watchStartFor,
  isStalled,
  mapPool,
  pollIntervalFor,
  remainingParts,
  rowPercent,
  rowsToResume,
  runSourcePipeline,
  stageSentence,
  uploadsReducer,
  validateSourceFile,
  type PipelineApi,
  type UploadRow,
} from "./pipeline";

const MB = 1024 * 1024;

describe("validateSourceFile", () => {
  it("checks type, size and emptiness before upload", () => {
    expect(validateSourceFile({ name: "a.pdf", size: 1000 }, SOURCE_LIMITS)).toBeNull();
    expect(validateSourceFile({ name: "a.PPTX", size: 1000 }, SOURCE_LIMITS)).toBeNull();
    expect(validateSourceFile({ name: "a.doc", size: 1000 }, SOURCE_LIMITS)).toBe("legacyType");
    expect(validateSourceFile({ name: "a.ppt", size: 1000 }, SOURCE_LIMITS)).toBe("legacyType");
    expect(validateSourceFile({ name: "a.zip", size: 1000 }, SOURCE_LIMITS)).toBe("unsupportedType");
    expect(validateSourceFile({ name: "noextension", size: 1000 }, SOURCE_LIMITS)).toBe("unsupportedType");
    expect(validateSourceFile({ name: "a.pdf", size: 0 }, SOURCE_LIMITS)).toBe("empty");
    expect(validateSourceFile({ name: "a.pdf", size: 26 * MB }, SOURCE_LIMITS)).toBe("tooLarge");
    expect(validateSourceFile({ name: "a.pdf", size: 25 * MB }, SOURCE_LIMITS)).toBeNull();
    expect(validateSourceFile({ name: "a.md", size: 3 * MB }, SOURCE_LIMITS)).toBe("tooLarge");
    expect(validateSourceFile({ name: "a.txt", size: 2 * MB }, SOURCE_LIMITS)).toBeNull();
  });
});

describe("mapPool", () => {
  it("never runs more than the limit at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    expect(peak).toBe(2);
  });
  it("stops starting new work after the first failure and rethrows it", async () => {
    const started: number[] = [];
    await expect(
      mapPool([0, 1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        if (item === 1) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
    ).rejects.toThrow("boom");
    expect(started.length).toBeLessThan(6);
  });
  it("rejects with UploadAbortedError when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(mapPool([1, 2], 2, async () => undefined, controller.signal)).rejects.toBeInstanceOf(UploadAbortedError);
  });
});

function fakeApi(partCount = 3) {
  const calls: string[] = [];
  const api: PipelineApi = {
    extract: async (id) => {
      calls.push(`extract:${id}`);
      return { partCount };
    },
    analyzePart: async (id, index) => {
      calls.push(`analyze:${id}:${index}`);
    },
    finalize: async (id) => {
      calls.push(`finalize:${id}`);
    },
  };
  return { api, calls };
}

describe("runSourcePipeline", () => {
  it("runs extract, every part, then finalize in order and reports stages", async () => {
    const { api, calls } = fakeApi(3);
    const stages: string[] = [];
    await runSourcePipeline(api, 7, { onStage: (s) => stages.push(s.stage === "summarizing" ? `summarizing ${s.done}/${s.total}` : s.stage) });
    expect(calls[0]).toBe("extract:7");
    expect(calls.slice(1, 4).sort()).toEqual(["analyze:7:0", "analyze:7:1", "analyze:7:2"]);
    expect(calls[4]).toBe("finalize:7");
    expect(stages[0]).toBe("reading");
    expect(stages).toContain("summarizing 3/3");
    expect(stages[stages.length - 1]).toBe("finishing");
  });

  it("resumes: skips extract and done parts", async () => {
    const { api, calls } = fakeApi();
    await runSourcePipeline(api, 7, { resume: { status: "analyzing", partCount: 4, doneParts: [0, 1] } });
    expect(calls.filter((c) => c.startsWith("extract"))).toHaveLength(0);
    expect(calls.filter((c) => c.startsWith("analyze")).sort()).toEqual(["analyze:7:2", "analyze:7:3"]);
    expect(calls[calls.length - 1]).toBe("finalize:7");
  });

  it("extracts again when resuming from uploaded, extracting or failed", async () => {
    for (const status of ["uploaded", "extracting", "failed"]) {
      const { api, calls } = fakeApi(1);
      await runSourcePipeline(api, 1, { resume: { status, partCount: 0, doneParts: [] } });
      expect(calls[0]).toBe("extract:1");
    }
  });

  it("does nothing for a ready source", async () => {
    const { api, calls } = fakeApi();
    await runSourcePipeline(api, 1, { resume: { status: "ready", partCount: 2, doneParts: [] } });
    expect(calls).toEqual([]);
  });

  it("stops between steps when aborted and never finalizes", async () => {
    const { api, calls } = fakeApi(4);
    const controller = new AbortController();
    const slow: PipelineApi = {
      ...api,
      analyzePart: async (id, index) => {
        calls.push(`analyze:${id}:${index}`);
        controller.abort();
      },
    };
    await expect(runSourcePipeline(slow, 1, { signal: controller.signal })).rejects.toBeInstanceOf(UploadAbortedError);
    expect(calls).not.toContain("finalize:1");
    expect(calls.filter((c) => c.startsWith("analyze")).length).toBeLessThan(4);
  });

  it("does not finalize when a part fails", async () => {
    const { api, calls } = fakeApi(3);
    const failing: PipelineApi = {
      ...api,
      analyzePart: async (id, index) => {
        if (index === 1) throw new Error("model failed");
        calls.push(`analyze:${id}:${index}`);
      },
    };
    await expect(runSourcePipeline(failing, 1)).rejects.toThrow("model failed");
    expect(calls).not.toContain("finalize:1");
  });
});

describe("helpers", () => {
  it("remainingParts", () => {
    expect(remainingParts(4, [1, 3])).toEqual([0, 2]);
    expect(remainingParts(0, [])).toEqual([]);
  });
  it("pollIntervalFor", () => {
    expect(pollIntervalFor(["ready", "failed"], 0)).toBe(false);
    expect(pollIntervalFor(["ready", "analyzing"], 1000)).toBe(4000);
    expect(pollIntervalFor(["analyzing"], 16 * 60 * 1000)).toBe(false);
  });
  it("isStalled", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    expect(isStalled({ status: "analyzing", updatedAt: new Date(now - 3 * 60 * 1000) }, now)).toBe(true);
    expect(isStalled({ status: "analyzing", updatedAt: new Date(now - 30 * 1000) }, now)).toBe(false);
    expect(isStalled({ status: "ready", updatedAt: new Date(now - 3600 * 1000) }, now)).toBe(false);
  });
});

describe("createUploadQueue", () => {
  it("runs two at a time, in order, and aborts waiting and running tasks", async () => {
    const queue = createUploadQueue({ concurrency: 2 });
    const started: string[] = [];
    const release: Record<string, () => void> = {};
    const task = (id: string) => (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        started.push(id);
        release[id] = resolve;
        signal.addEventListener("abort", () => reject(new UploadAbortedError()));
      });
    queue.add("a", task("a"));
    queue.add("b", task("b"));
    queue.add("c", task("c"));
    expect(queue.snapshot()).toEqual({ running: ["a", "b"], waiting: ["c"] });
    queue.abort("c");
    expect(queue.has("c")).toBe(false);
    queue.abort("a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.has("a")).toBe(false);
    release.b();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b"]);
    expect(queue.snapshot().running).toEqual([]);
  });
  it("keeps going after a task fails and ignores duplicate ids", async () => {
    const queue = createUploadQueue({ concurrency: 1 });
    const ran: string[] = [];
    queue.add("x", async () => {
      ran.push("x");
      throw new Error("no");
    });
    queue.add("x", async () => undefined);
    queue.add("y", async () => {
      ran.push("y");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toEqual(["x", "y"]);
  });
});

function row(patch: Partial<UploadRow> = {}): UploadRow {
  return { id: "r1", name: "a.pdf", size: 10, courseId: 1, stage: "waiting", progress: 0, partsDone: 0, partsTotal: 0, sourceId: null, error: null, canRetry: true, ...patch };
}

describe("uploadsReducer", () => {
  it("adds, patches, removes, and removes only finished rows on removeDone", () => {
    let rows = uploadsReducer([], { type: "add", rows: [row(), row({ id: "r2" })] });
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    rows = uploadsReducer(rows, { type: "patch", id: "r1", change: { stage: "uploading", progress: 40 } });
    expect(rows[0]).toMatchObject({ stage: "uploading", progress: 40 });
    rows = uploadsReducer(rows, { type: "removeDone", id: "r1" });
    expect(rows).toHaveLength(2);
    rows = uploadsReducer(rows, { type: "patch", id: "r1", change: { stage: "done" } });
    rows = uploadsReducer(rows, { type: "removeDone", id: "r1" });
    expect(rows.map((r) => r.id)).toEqual(["r2"]);
    rows = uploadsReducer(rows, { type: "remove", id: "r2" });
    expect(rows).toEqual([]);
  });
  it("replaces a row added again with the same id", () => {
    const rows = uploadsReducer([row({ stage: "error" })], { type: "add", rows: [row({ stage: "waiting" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe("waiting");
  });
});

describe("rowsToResume", () => {
  it("picks mid-pipeline rows nobody owns and rows paused offline", () => {
    const rows = [
      row({ id: "a", stage: "summarizing" }),
      row({ id: "b", stage: "summarizing" }),
      row({ id: "c", stage: "error", error: { kind: "offline" } }),
      row({ id: "d", stage: "error", error: { kind: "usageLimit" } }),
      row({ id: "e", stage: "uploading" }),
      row({ id: "f", stage: "error", error: { kind: "offline" }, canRetry: false }),
    ];
    expect(rowsToResume(rows, (id) => id === "b")).toEqual(["a", "c"]);
  });
});

describe("row wording", () => {
  it("shows percent only when it is known", () => {
    expect(rowPercent({ stage: "uploading", progress: 41.6, partsDone: 0, partsTotal: 0 })).toBe(42);
    expect(rowPercent({ stage: "reading", progress: 100, partsDone: 0, partsTotal: 0 })).toBeNull();
    expect(rowPercent({ stage: "summarizing", progress: 100, partsDone: 1, partsTotal: 4 })).toBe(25);
    expect(rowPercent({ stage: "summarizing", progress: 100, partsDone: 0, partsTotal: 0 })).toBeNull();
    expect(rowPercent({ stage: "finishing", progress: 100, partsDone: 4, partsTotal: 4 })).toBe(100);
  });
  it("describes the stage", () => {
    expect(stageSentence({ stage: "summarizing", partsDone: 1, partsTotal: 4 })).toBe("Summarizing, part 2 of 4");
    expect(stageSentence({ stage: "reading", partsDone: 0, partsTotal: 0 })).toBe("Reading the file");
  });
});

describe("user switch and cancelling", () => {
  it("reset empties every row", () => {
    expect(uploadsReducer([row(), row({ id: "r2" })], { type: "reset" })).toEqual([]);
  });

  it("cancelPlan removes only what this upload created", () => {
    const base = { rowId: "source-upload-1", stage: "uploading" as const, sourceId: null, running: true };
    expect(cancelPlan(base)).toBe("removeAfterAbort");
    expect(cancelPlan({ ...base, stage: "saving" })).toBe("removeAfterAbort");
    expect(cancelPlan({ ...base, running: false, sourceId: 4, stage: "waiting" })).toBe("removeNow");
    expect(cancelPlan({ ...base, running: false })).toBe("none");
  });

  it("never deletes a source that was already in the library", () => {
    expect(cancelPlan({ rowId: "resume-9", stage: "summarizing", sourceId: 9, running: true })).toBe("none");
    expect(cancelPlan({ rowId: "resume-9", stage: "waiting", sourceId: 9, running: false })).toBe("none");
    expect(cancelPlan({ rowId: "source-upload-1", stage: "error", sourceId: 9, running: false })).toBe("none");
    expect(cancelPlan({ rowId: "source-upload-1", stage: "done", sourceId: 9, running: false })).toBe("none");
  });
});

describe("size, parts and watch window", () => {
  it("uses the copied file's size when the picker reports none", () => {
    expect(effectiveSize(undefined, 1234)).toBe(1234);
    expect(effectiveSize(0, 1234)).toBe(1234);
    expect(effectiveSize(500, 0)).toBe(500);
    expect(effectiveSize(null, 0)).toBe(0);
    // A picker asset with no size is no longer an empty file.
    const size = effectiveSize(0, 2048);
    expect(validateSourceFile({ name: "notes.pdf", size }, SOURCE_LIMITS)).toBeNull();
  });
  it("doneParts lists the parts the server holds", () => {
    expect(doneParts([{ index: 0, done: true }, { index: 1, done: false }, { index: 2, done: true }])).toEqual([0, 2]);
  });
  it("a resumed pipeline only analyses the missing parts", async () => {
    const { api, calls } = fakeApi();
    await runSourcePipeline(api, 3, { resume: { status: "analyzing", partCount: 3, doneParts: doneParts([{ index: 0, done: true }, { index: 1, done: true }, { index: 2, done: false }]) } });
    expect(calls.filter((c) => c.startsWith("analyze"))).toEqual(["analyze:3:2"]);
  });
  it("watchStartFor restarts the window only when work newly appears", () => {
    expect(watchStartFor({ working: true, wasWorking: false, watchedSince: 1, now: 99 })).toBe(99);
    expect(watchStartFor({ working: true, wasWorking: true, watchedSince: 1, now: 99 })).toBe(1);
    expect(watchStartFor({ working: false, wasWorking: true, watchedSince: 1, now: 99 })).toBe(1);
    // After the 15 minute window, new work polls again.
    const start = watchStartFor({ working: true, wasWorking: false, watchedSince: 0, now: 20 * 60 * 1000 });
    expect(pollIntervalFor(["analyzing"], 20 * 60 * 1000 - start)).toBe(4000);
  });
});
