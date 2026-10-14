import type { OfflinePack, QueuedReview } from "./offlinePack";

// IndexedDB storage for recordings kept offline and flashcard reviews made
// offline (Phase 7). Listed in the Cookie Policy as "studyscribe-offline".
// Cleared on sign-out (clearOfflineData) so a shared computer keeps nothing.

const DB_NAME = "studyscribe-offline";
const DB_VERSION = 1;
const PACKS = "packs";
const QUEUE = "reviewQueue";

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
      if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: "recordingId" });
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "id", autoIncrement: true });
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

function all<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export function offlineStorageAvailable() {
  return typeof indexedDB !== "undefined";
}

export async function savePack(pack: OfflinePack): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(PACKS, "readwrite");
  tx.objectStore(PACKS).put(pack);
  await done(tx);
  notify();
}

export async function removePack(recordingId: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(PACKS, "readwrite");
  tx.objectStore(PACKS).delete(recordingId);
  await done(tx);
  notify();
}

export async function listPacks(userId: number): Promise<OfflinePack[]> {
  const db = await openDb();
  const packs = await all<OfflinePack>(db.transaction(PACKS).objectStore(PACKS));
  return packs.filter((p) => p.userId === userId).sort((a, b) => b.savedAt - a.savedAt);
}

export async function getPack(userId: number, recordingId: number): Promise<OfflinePack | null> {
  const packs = await listPacks(userId);
  return packs.find((p) => p.recordingId === recordingId) ?? null;
}

export async function queueReview(review: Omit<QueuedReview, "id">): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(QUEUE, "readwrite");
  tx.objectStore(QUEUE).add(review);
  await done(tx);
  notify();
}

export async function listQueuedReviews(userId: number): Promise<QueuedReview[]> {
  const db = await openDb();
  const rows = await all<QueuedReview>(db.transaction(QUEUE).objectStore(QUEUE));
  return rows.filter((r) => r.userId === userId).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function removeQueuedReview(id: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(QUEUE, "readwrite");
  tx.objectStore(QUEUE).delete(id);
  await done(tx);
  notify();
}

/** Everything kept offline, for every account on this browser. Called on sign-out. */
export async function clearOfflineData(): Promise<void> {
  if (!offlineStorageAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction([PACKS, QUEUE], "readwrite");
    tx.objectStore(PACKS).clear();
    tx.objectStore(QUEUE).clear();
    await done(tx);
    notify();
  } catch {
    // Nothing stored, or storage blocked: nothing to clear.
  }
}

// A tiny change signal so open pages refresh when a pack or the queue changes.
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((listener) => listener());
}
export function onOfflineChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
