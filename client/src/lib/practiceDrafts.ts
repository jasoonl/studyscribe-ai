export const DRAFT_PREFIX = "studyscribe_practice_draft:";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function draftKey(sessionId: number): string {
  return `${DRAFT_PREFIX}${sessionId}`;
}

export function readDraft(sessionId: number, storage: StorageLike | null = safeStorage()): Record<string, string> | null {
  try {
    const raw = storage?.getItem(draftKey(sessionId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
    return out;
  } catch {
    return null;
  }
}

export function writeDraft(sessionId: number, answers: Record<string, string>, storage: StorageLike | null = safeStorage()) {
  try {
    storage?.setItem(draftKey(sessionId), JSON.stringify(answers));
  } catch {
    // Storage can be full or blocked; the server copy still has the last save.
  }
}

export function clearDraft(sessionId: number, storage: StorageLike | null = safeStorage()) {
  try {
    storage?.removeItem(draftKey(sessionId));
  } catch {
    // Nothing to clear.
  }
}

/** Sign-out: no answer text from a practice exam stays on a shared computer. */
export function clearAllPracticeDrafts(storage: (StorageLike & { length: number; key(index: number): string | null }) | null = safeStorage() as never) {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
}
