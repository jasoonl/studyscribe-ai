import { createUploadStore, nextStepFor, restoredError, type JournalFs, type StoredJob } from "./uploadStore";

function memoryFs(initial: string | null = null) {
  const state = { text: initial };
  const fs: JournalFs = {
    read: () => state.text,
    write: (text) => {
      state.text = text;
    },
    remove: () => {
      state.text = null;
    },
  };
  return { fs, state };
}

const job = (patch: Partial<StoredJob> = {}): StoredJob => ({ rowId: "r1", uri: "file:///x/a.pdf", name: "a.pdf", size: 10, courseId: 3, stage: "waiting", ...patch });

describe("nextStepFor", () => {
  it("continues from the furthest step reached", () => {
    expect(nextStepFor({ uri: "file:///a", key: undefined, sourceId: undefined })).toBe("prepare");
    expect(nextStepFor({ uri: "file:///a", key: "1/sources/x", sourceId: undefined })).toBe("register");
    expect(nextStepFor({ uri: "file:///a", key: "1/sources/x", sourceId: 9 })).toBe("pipeline");
    expect(nextStepFor({ uri: "", key: undefined, sourceId: 9 })).toBe("pipeline");
    expect(nextStepFor({ uri: "", key: undefined, sourceId: undefined })).toBe("drop");
  });
});

describe("upload store", () => {
  it("round trips jobs for the same person", () => {
    const { fs } = memoryFs();
    const store = createUploadStore(fs);
    store.save(5, [job(), job({ rowId: "r2", sourceId: 8, key: "k" })]);
    expect(store.load(5)).toHaveLength(2);
    expect(store.load(5)[1]).toMatchObject({ rowId: "r2", sourceId: 8 });
  });
  it("discards another person's journal", () => {
    const { fs, state } = memoryFs();
    const store = createUploadStore(fs);
    store.save(5, [job()]);
    expect(store.load(6)).toEqual([]);
    expect(state.text).toBeNull();
  });
  it("removes the file when nothing is left, and survives garbage", () => {
    const { fs, state } = memoryFs();
    const store = createUploadStore(fs);
    store.save(5, [job()]);
    store.save(5, []);
    expect(state.text).toBeNull();
    expect(createUploadStore(memoryFs("not json").fs).load(5)).toEqual([]);
    expect(createUploadStore(memoryFs(JSON.stringify({ userId: 5, jobs: [{ rowId: 1 }, job(), job({ uri: "" })] })).fs).load(5)).toHaveLength(1);
  });
});

describe("restoring errors", () => {
  it("keeps the recorded cause across a relaunch", () => {
    const { fs } = memoryFs();
    const store = createUploadStore(fs);
    store.save(5, [job({ errored: true, error: { kind: "usageLimit" } }), job({ rowId: "r2", errored: true, error: { kind: "message", text: "A course can hold up to 25 study sources." } })]);
    const loaded = store.load(5);
    expect(restoredError(loaded[0])).toEqual({ kind: "usageLimit" });
    expect(restoredError(loaded[1])).toEqual({ kind: "message", text: "A course can hold up to 25 study sources." });
  });
  it("tolerates old entries that only say errored, and drops bad error values", () => {
    expect(restoredError({ errored: true })).toEqual({ kind: "paused" });
    expect(restoredError({})).toBeNull();
    const text = JSON.stringify({ userId: 5, jobs: [job({ errored: true }), job({ rowId: "bad", error: { kind: "nonsense" } as never })] });
    expect(createUploadStore(memoryFs(text).fs).load(5)).toHaveLength(1);
  });
});

describe("switching people", () => {
  it("a journal saved for one person is never loaded or kept for another", () => {
    const { fs, state } = memoryFs();
    const store = createUploadStore(fs);
    store.save(1, [job()]);
    expect(store.load(2)).toEqual([]);
    expect(state.text).toBeNull();
    store.save(2, [job({ rowId: "b1" })]);
    expect(store.load(1)).toEqual([]);
  });
});
