/**
 * Crash backup for tab recordings. The offscreen recorder writes every
 * one-second chunk to IndexedDB as it arrives, so a recording survives the
 * browser closing, Chrome or the extension restarting, or an upload that
 * fails: the popup then offers it back ("Save to StudyScribe" or "Discard").
 * A backup is removed once the recording is safely in StudyScribe or the
 * person discards it, and backups older than a week are pruned.
 *
 * The store is an interface so the logic can be tested without a browser;
 * `createIdbBackupStore` is the real one (the extension's own origin, shared
 * by the popup and the offscreen document).
 */

export type BackupMeta = {
  id: string;
  title: string;
  language?: string;
  /** StudyScribe origin the recording was meant for. */
  origin: string;
  /** Who was signed in when it started; another account is never offered it. */
  ownerId?: number;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  durationSeconds: number;
  chunks: number;
  bytes: number;
  /** Set once an upload of this backup has failed, so the popup can say so. */
  failedAt?: number;
};

export interface BackupStore {
  putMeta(meta: BackupMeta): Promise<void>;
  putChunk(id: string, index: number, blob: Blob): Promise<void>;
  list(): Promise<BackupMeta[]>;
  get(id: string): Promise<BackupMeta | null>;
  readChunks(id: string): Promise<Blob[]>;
  remove(id: string): Promise<void>;
}

export const MAX_BACKUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function newBackupId(now = Date.now()): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${now}-${random}`;
}

/**
 * Writes one recording's chunks in order. Writes are queued so a slow disk
 * never reorders them; a failed write is remembered (`degraded`) but never
 * stops the recording itself.
 */
export class RecordingBackup {
  private queue: Promise<void> = Promise.resolve();
  private index = 0;
  degraded = false;

  constructor(
    private readonly store: BackupStore,
    readonly meta: BackupMeta,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records the session before any audio, so even a crash in the first second leaves a trace to clean up. */
  begin(): Promise<void> {
    return this.enqueue(() => this.store.putMeta({ ...this.meta }));
  }

  append(blob: Blob): Promise<void> {
    if (blob.size === 0) return this.queue;
    const index = this.index++;
    return this.enqueue(async () => {
      await this.store.putChunk(this.meta.id, index, blob);
      this.meta.chunks = index + 1;
      this.meta.bytes += blob.size;
      this.meta.updatedAt = this.now();
      this.meta.durationSeconds = Math.max(1, Math.round((this.meta.updatedAt - this.meta.startedAt) / 1000));
      await this.store.putMeta({ ...this.meta });
    });
  }

  /** Resolves once every queued write has finished. */
  flush(): Promise<void> {
    return this.queue;
  }

  markFailed(): Promise<void> {
    return this.enqueue(() => this.store.putMeta({ ...this.meta, failedAt: this.now() }));
  }

  remove(): Promise<void> {
    return this.enqueue(() => this.store.remove(this.meta.id));
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work).catch(error => {
      this.degraded = true;
      console.warn("[backup] could not write the crash backup", error);
    });
    return this.queue;
  }
}

/**
 * Backups to offer back: with audio in them, not the recording running right
 * now, not another account's, newest first.
 */
export function recoverableBackups(backups: BackupMeta[], options: { userId: number; activeId?: string | null; now?: number }): BackupMeta[] {
  const now = options.now ?? Date.now();
  return backups
    .filter(meta => meta.chunks > 0 && meta.bytes > 0)
    .filter(meta => meta.id !== options.activeId)
    .filter(meta => meta.ownerId === undefined || meta.ownerId === options.userId)
    .filter(meta => now - meta.updatedAt <= MAX_BACKUP_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Backups to delete: past the age limit, or empty and no longer being written. */
export function staleBackups(backups: BackupMeta[], options: { activeId?: string | null; now?: number }): BackupMeta[] {
  const now = options.now ?? Date.now();
  return backups.filter(meta => meta.id !== options.activeId && (now - meta.updatedAt > MAX_BACKUP_AGE_MS || (meta.chunks === 0 && now - meta.updatedAt > 60_000)));
}

/** In-memory store, for tests. */
export function createMemoryBackupStore(): BackupStore & { metas: Map<string, BackupMeta>; chunks: Map<string, Map<number, Blob>> } {
  const metas = new Map<string, BackupMeta>();
  const chunks = new Map<string, Map<number, Blob>>();
  return {
    metas,
    chunks,
    async putMeta(meta) {
      metas.set(meta.id, { ...meta });
    },
    async putChunk(id, index, blob) {
      if (!chunks.has(id)) chunks.set(id, new Map());
      chunks.get(id)!.set(index, blob);
    },
    async list() {
      return Array.from(metas.values()).map(meta => ({ ...meta }));
    },
    async get(id) {
      const meta = metas.get(id);
      return meta ? { ...meta } : null;
    },
    async readChunks(id) {
      const byIndex = chunks.get(id) ?? new Map<number, Blob>();
      return Array.from(byIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, blob]) => blob);
    },
    async remove(id) {
      metas.delete(id);
      chunks.delete(id);
    },
  };
}

const DB_NAME = "studyscribe-recording-backup";
const DB_VERSION = 1;
const META = "sessions";
const CHUNKS = "chunks";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Backup write aborted"));
  });
}

/** The real store: IndexedDB in the extension's origin. */
export function createIdbBackupStore(factory: IDBFactory = indexedDB): BackupStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["id", "index"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    });
    return opening;
  };

  return {
    async putMeta(meta) {
      const db = await open();
      const tx = db.transaction(META, "readwrite");
      tx.objectStore(META).put(meta);
      await done(tx);
    },
    async putChunk(id, index, blob) {
      const db = await open();
      const tx = db.transaction(CHUNKS, "readwrite");
      tx.objectStore(CHUNKS).put({ id, index, blob });
      await done(tx);
    },
    async list() {
      const db = await open();
      return request(db.transaction(META).objectStore(META).getAll() as IDBRequest<BackupMeta[]>);
    },
    async get(id) {
      const db = await open();
      return (await request(db.transaction(META).objectStore(META).get(id) as IDBRequest<BackupMeta | undefined>)) ?? null;
    },
    async readChunks(id) {
      const db = await open();
      const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
      const rows = await request(db.transaction(CHUNKS).objectStore(CHUNKS).getAll(range) as IDBRequest<Array<{ index: number; blob: Blob }>>);
      return rows.sort((a, b) => a.index - b.index).map(row => row.blob);
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction([META, CHUNKS], "readwrite");
      tx.objectStore(META).delete(id);
      tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      await done(tx);
    },
  };
}
