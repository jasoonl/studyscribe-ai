/**
 * Keeps an in-progress microphone recording in IndexedDB, one chunk at a time,
 * so a crash, reload, closed tab or a tab the browser discarded doesn't lose a
 * lecture. Every call swallows its own errors: storage can be unavailable
 * (private windows, full disk) and that must never stop the recording itself.
 */
const DB_NAME = "studyscribe-recorder";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const CHUNKS = "chunks";

export type BackupSession = {
  id: string;
  userId: number | null;
  mimeType: string;
  startedAt: number;
  elapsedSeconds: number;
  updatedAt: number;
};

export type RecoveredRecording = BackupSession & { blob: Blob };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["sessionId", "seq"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function chunkRange(sessionId: string) {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
}

export async function saveSession(session: BackupSession): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(SESSIONS, "readwrite");
    tx.objectStore(SESSIONS).put(session);
    await done(tx);
  } catch {
    // Backup is best effort.
  }
}

export async function appendChunk(sessionId: string, seq: number, data: Blob, elapsedSeconds: number): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(CHUNKS).put({ sessionId, seq, data });
    const sessions = tx.objectStore(SESSIONS);
    const request = sessions.get(sessionId);
    request.onsuccess = () => {
      const session = request.result as BackupSession | undefined;
      if (session) sessions.put({ ...session, elapsedSeconds, updatedAt: Date.now() });
    };
    await done(tx);
  } catch {
    // Backup is best effort.
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(SESSIONS).delete(sessionId);
    tx.objectStore(CHUNKS).delete(chunkRange(sessionId));
    await done(tx);
  } catch {
    // Backup is best effort.
  }
}

/**
 * The most recent unsaved recording for this user, if one survived. Sessions
 * in `excludeIds` are still live in another tab and are left alone.
 */
export async function loadUnsavedRecording(
  userId: number | null,
  excludeIds: ReadonlySet<string> = new Set(),
): Promise<RecoveredRecording | null> {
  try {
    const db = await openDb();
    const tx = db.transaction([SESSIONS, CHUNKS], "readonly");
    const sessionsRequest = tx.objectStore(SESSIONS).getAll();
    const sessions = await new Promise<BackupSession[]>((resolve, reject) => {
      sessionsRequest.onsuccess = () => resolve(sessionsRequest.result as BackupSession[]);
      sessionsRequest.onerror = () => reject(sessionsRequest.error);
    });
    const session = sessions
      .filter(candidate => candidate.userId === userId && !excludeIds.has(candidate.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!session) return null;

    const chunksRequest = tx.objectStore(CHUNKS).getAll(chunkRange(session.id));
    const chunks = await new Promise<Array<{ data: Blob }>>((resolve, reject) => {
      chunksRequest.onsuccess = () => resolve(chunksRequest.result as Array<{ data: Blob }>);
      chunksRequest.onerror = () => reject(chunksRequest.error);
    });
    if (chunks.length === 0) {
      void deleteSession(session.id);
      return null;
    }
    return { ...session, blob: new Blob(chunks.map(chunk => chunk.data), { type: session.mimeType }) };
  } catch {
    return null;
  }
}
