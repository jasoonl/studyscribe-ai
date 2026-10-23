import { describe, expect, it, vi } from "vitest";
import { createUploadQueue } from "./sourceUploadQueue";
import {
  acceptAttribute,
  isStalled,
  mapPool,
  notesToFile,
  pollIntervalFor,
  putWithProgress,
  remainingParts,
  runSourcePipeline,
  SOURCE_POLL_GIVE_UP_MS,
  SOURCE_POLL_MS,
  UploadAbortedError,
  validateSourceFile,
  type PipelineApi,
  type SourceLimits,
} from "./sourceUpload";

const limits: SourceLimits = { maxBytes: 25 * 1024 * 1024, maxTextBytes: 2 * 1024 * 1024, extensions: ["pdf", "pptx", "docx", "txt", "md", "markdown"] };

describe("validateSourceFile", () => {
  it("accepts supported files", () => {
    expect(validateSourceFile({ name: "Week 3.PDF", size: 1000 }, limits)).toBeNull();
    expect(validateSourceFile({ name: "slides.pptx", size: limits.maxBytes }, limits)).toBeNull();
  });
  it("rejects unsupported and legacy formats", () => {
    expect(validateSourceFile({ name: "photo.png", size: 10 }, limits)).toBe("unsupportedType");
    expect(validateSourceFile({ name: "noextension", size: 10 }, limits)).toBe("unsupportedType");
    expect(validateSourceFile({ name: "old.doc", size: 10 }, limits)).toBe("legacyType");
    expect(validateSourceFile({ name: "old.ppt", size: 10 }, limits)).toBe("legacyType");
  });
  it("applies the smaller cap to text and rejects empty files", () => {
    expect(validateSourceFile({ name: "n.txt", size: limits.maxTextBytes + 1 }, limits)).toBe("tooLarge");
    expect(validateSourceFile({ name: "n.pdf", size: limits.maxTextBytes + 1 }, limits)).toBeNull();
    expect(validateSourceFile({ name: "n.pdf", size: limits.maxBytes + 1 }, limits)).toBe("tooLarge");
    expect(validateSourceFile({ name: "n.pdf", size: 0 }, limits)).toBe("empty");
  });
});

describe("accept attribute and pasted notes", () => {
  it("builds the accept list", () => {
    expect(acceptAttribute(["pdf", "md"])).toBe(".pdf,.md");
  });
  it("turns notes into a .txt file with a safe name", () => {
    const file = notesToFile('  Bio: week 3 / "cells"  ', "hello");
    expect(file.name).toBe("Bio week 3 cells.txt");
    expect(file.type).toBe("text/plain");
    expect(file.size).toBe(5);
    expect(notesToFile("   ", "x").name).toBe("Notes.txt");
  });
});

class FakeRequest {
  upload: { onprogress: ((event: unknown) => void) | null } = { onprogress: null };
  onload: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onabort: ((event: unknown) => void) | null = null;
  status = 0;
  responseText = "";
  headers: Record<string, string> = {};
  method = "";
  url = "";
  sent: unknown = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.onabort?.({});
  }
}

describe("putWithProgress", () => {
  const make = () => {
    const request = new FakeRequest();
    return { request, createRequest: () => request as never };
  };

  it("reports progress and resolves on success", async () => {
    const { request, createRequest } = make();
    const onProgress = vi.fn();
    const promise = putWithProgress("https://blob.example/x", new Blob(["a"]), "application/octet-stream", { onProgress, createRequest });
    request.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    request.status = 200;
    request.onload?.({});
    await expect(promise).resolves.toBeUndefined();
    expect(request.method).toBe("PUT");
    expect(request.headers["Content-Type"]).toBe("application/octet-stream");
    expect(onProgress).toHaveBeenNthCalledWith(1, 25);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it("rejects on a refused upload and on a dropped connection", async () => {
    const refused = make();
    const first = putWithProgress("u", new Blob(["a"]), "x", { createRequest: refused.createRequest });
    refused.request.status = 403;
    refused.request.onload?.({});
    await expect(first).rejects.toThrow("403");

    const dropped = make();
    const second = putWithProgress("u", new Blob(["a"]), "x", { createRequest: dropped.createRequest });
    dropped.request.onerror?.({});
    await expect(second).rejects.toThrow("connection");
  });

  it("aborts through the signal, and refuses to start when already aborted", async () => {
    const controller = new AbortController();
    const { createRequest } = make();
    const promise = putWithProgress("u", new Blob(["a"]), "x", { signal: controller.signal, createRequest });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(UploadAbortedError);
    await expect(putWithProgress("u", new Blob(["a"]), "x", { signal: controller.signal, createRequest })).rejects.toBeInstanceOf(UploadAbortedError);
  });
});

describe("createUploadQueue", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    return { promise, resolve };
  };

  it("runs two at a time and starts the next when one finishes", async () => {
    const queue = createUploadQueue({ concurrency: 2 });
    const gates = [deferred(), deferred(), deferred(), deferred()];
    gates.forEach((gate, index) => queue.add(`f${index}`, () => gate.promise));
    expect(queue.snapshot()).toEqual({ running: ["f0", "f1"], waiting: ["f2", "f3"] });
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(queue.snapshot().running).toEqual(["f1", "f2"]);
    expect(queue.snapshot().waiting).toEqual(["f3"]);
  });

  it("removes a waiting task and aborts a running one", async () => {
    const queue = createUploadQueue({ concurrency: 1 });
    let signal: AbortSignal | undefined;
    const gate = deferred();
    queue.add("a", s => {
      signal = s;
      return gate.promise;
    });
    const second = vi.fn(async () => undefined);
    queue.add("b", second);
    queue.abort("b");
    expect(queue.has("b")).toBe(false);
    queue.abort("a");
    expect(signal?.aborted).toBe(true);
    gate.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(second).not.toHaveBeenCalled();
  });

  it("keeps going after a task throws, and ignores a duplicate id", async () => {
    const queue = createUploadQueue({ concurrency: 1 });
    const ran = vi.fn(async () => undefined);
    queue.add("a", async () => {
      throw new Error("boom");
    });
    queue.add("a", ran);
    queue.add("b", ran);
    await new Promise(r => setTimeout(r, 0));
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("abortAll clears the line and cancels what runs", () => {
    const queue = createUploadQueue({ concurrency: 1 });
    const signals: AbortSignal[] = [];
    queue.add("a", s => {
      signals.push(s);
      return new Promise(() => undefined);
    });
    queue.add("b", async () => undefined);
    queue.abortAll();
    expect(signals[0].aborted).toBe(true);
    expect(queue.snapshot().waiting).toEqual([]);
  });
});

describe("mapPool and runSourcePipeline", () => {
  it("never has more than the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5], 2, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it("stops at the first failure", async () => {
    const seen: number[] = [];
    await expect(
      mapPool([1, 2, 3, 4], 1, async item => {
        seen.push(item);
        if (item === 2) throw new Error("bad part");
      }),
    ).rejects.toThrow("bad part");
    expect(seen).toEqual([1, 2]);
  });

  it("runs extract, every part, then finalize, reporting stages", async () => {
    const calls: string[] = [];
    const api: PipelineApi = {
      extract: async () => {
        calls.push("extract");
        return { partCount: 3 };
      },
      analyzePart: async (_id, index) => void calls.push(`part${index}`),
      finalize: async () => void calls.push("finalize"),
    };
    const stages: string[] = [];
    await runSourcePipeline(api, 9, { onStage: stage => stages.push(stage.stage === "summarizing" ? `s${stage.done}/${stage.total}` : stage.stage) });
    expect(calls[0]).toBe("extract");
    expect(calls.at(-1)).toBe("finalize");
    expect(calls.slice(1, 4).sort()).toEqual(["part0", "part1", "part2"]);
    expect(stages[0]).toBe("reading");
    expect(stages).toContain("s3/3");
    expect(stages.at(-1)).toBe("finishing");
  });

  it("resumes without repeating finished work", async () => {
    const analyzePart = vi.fn(async () => undefined);
    const extract = vi.fn(async () => ({ partCount: 9 }));
    const finalize = vi.fn(async () => undefined);
    await runSourcePipeline({ extract, analyzePart, finalize }, 1, { resume: { status: "analyzing", partCount: 4, doneParts: [0, 2] } });
    expect(extract).not.toHaveBeenCalled();
    expect(analyzePart.mock.calls.map(call => (call as unknown as [number, number])[1]).sort()).toEqual([1, 3]);
    expect(finalize).toHaveBeenCalledTimes(1);

    const again = { extract: vi.fn(), analyzePart: vi.fn(), finalize: vi.fn() };
    await runSourcePipeline(again as never, 1, { resume: { status: "ready", partCount: 4, doneParts: [] } });
    expect(again.finalize).not.toHaveBeenCalled();
  });

  it("stops when aborted and does not finalize", async () => {
    const controller = new AbortController();
    const finalize = vi.fn(async () => undefined);
    const api: PipelineApi = {
      extract: async () => ({ partCount: 4 }),
      analyzePart: async (_id, index) => {
        if (index === 0) controller.abort();
      },
      finalize,
    };
    await expect(runSourcePipeline(api, 1, { signal: controller.signal, concurrency: 1 })).rejects.toBeInstanceOf(UploadAbortedError);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("lists remaining parts", () => {
    expect(remainingParts(4, [1])).toEqual([0, 2, 3]);
    expect(remainingParts(0, [])).toEqual([]);
  });
});

describe("polling", () => {
  it("polls only while a source is mid-pipeline, and gives up after fifteen minutes", () => {
    expect(pollIntervalFor(["ready", "failed"], 0)).toBe(false);
    expect(pollIntervalFor([], 0)).toBe(false);
    expect(pollIntervalFor(["ready", "analyzing"], 1000)).toBe(SOURCE_POLL_MS);
    expect(pollIntervalFor(["extracting"], SOURCE_POLL_GIVE_UP_MS)).toBe(false);
  });
  it("calls an untouched working source stalled", () => {
    const now = Date.now();
    expect(isStalled({ status: "analyzing", updatedAt: new Date(now - 5 * 60_000) }, now)).toBe(true);
    expect(isStalled({ status: "analyzing", updatedAt: new Date(now - 10_000) }, now)).toBe(false);
    expect(isStalled({ status: "ready", updatedAt: new Date(now - 99 * 60_000) }, now)).toBe(false);
  });
});
