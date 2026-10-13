import { describe, expect, it } from "vitest";
import { MAX_BACKUP_AGE_MS, RecordingBackup, createMemoryBackupStore, recoverableBackups, staleBackups, type BackupMeta, type BackupStore } from "./backup";

const meta = (overrides: Partial<BackupMeta> = {}): BackupMeta => ({
  id: "a",
  title: "Cells",
  origin: "https://studyscribe.example",
  ownerId: 7,
  mimeType: "audio/webm",
  startedAt: 1_000,
  updatedAt: 1_000,
  durationSeconds: 0,
  chunks: 0,
  bytes: 0,
  ...overrides,
});

describe("RecordingBackup", () => {
  it("stores chunks in order with a running length and size", async () => {
    const store = createMemoryBackupStore();
    let now = 1_000;
    const backup = new RecordingBackup(store, meta(), () => now);
    await backup.begin();
    now = 2_000;
    void backup.append(new Blob(["one"]));
    now = 3_400;
    void backup.append(new Blob(["two!"]));
    void backup.append(new Blob([])); // empty chunks are skipped
    await backup.flush();
    const saved = await store.get("a");
    expect(saved).toMatchObject({ chunks: 2, bytes: 7, durationSeconds: 2, updatedAt: 3_400 });
    const chunks = await store.readChunks("a");
    expect(await Promise.all(chunks.map(chunk => chunk.text()))).toEqual(["one", "two!"]);
  });

  it("never throws when the disk refuses a write, and says it is degraded", async () => {
    const failing: BackupStore = { ...createMemoryBackupStore(), putChunk: async () => { throw new Error("QuotaExceededError"); } };
    const backup = new RecordingBackup(failing, meta());
    await expect(backup.append(new Blob(["x"]))).resolves.toBeUndefined();
    expect(backup.degraded).toBe(true);
  });

  it("marks a failed upload and removes everything once saved", async () => {
    const store = createMemoryBackupStore();
    const backup = new RecordingBackup(store, meta(), () => 5_000);
    await backup.append(new Blob(["x"]));
    await backup.markFailed();
    expect((await store.get("a"))?.failedAt).toBe(5_000);
    await backup.remove();
    expect(await store.list()).toEqual([]);
    expect(await store.readChunks("a")).toEqual([]);
  });
});

describe("which backups to offer", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const list = [
    meta({ id: "old", chunks: 3, bytes: 10, updatedAt: now - MAX_BACKUP_AGE_MS - 1 }),
    meta({ id: "empty", chunks: 0, bytes: 0, updatedAt: now - 120_000 }),
    meta({ id: "live", chunks: 5, bytes: 50, updatedAt: now }),
    meta({ id: "theirs", chunks: 2, bytes: 20, updatedAt: now, ownerId: 8 }),
    meta({ id: "mine-older", chunks: 2, bytes: 20, updatedAt: now - 5_000 }),
    meta({ id: "mine-newer", chunks: 2, bytes: 20, updatedAt: now - 1_000, ownerId: undefined }),
  ];

  it("offers the person's own, newest first, never the running one", () => {
    expect(recoverableBackups(list, { userId: 7, activeId: "live", now }).map(item => item.id)).toEqual(["mine-newer", "mine-older"]);
  });

  it("prunes expired and abandoned empty backups, but not the running one", () => {
    expect(staleBackups(list, { activeId: "live", now }).map(item => item.id).sort()).toEqual(["empty", "old"]);
    expect(staleBackups([meta({ id: "live", chunks: 0, updatedAt: 0 })], { activeId: "live", now })).toEqual([]);
  });
});
