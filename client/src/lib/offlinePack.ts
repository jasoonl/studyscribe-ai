// What one recording looks like when kept for offline use (Phase 7). Pure helpers;
// the IndexedDB side is offlineStore.ts.

/**
 * The account whose recordings are kept offline. The offline page runs without
 * a connection, so it cannot ask the server who is signed in; cleared on sign-out.
 */
export const OFFLINE_OWNER_KEY = "studyscribe_offline_user";

export type OfflineSegment = { start: number; speaker: string | null; text: string };
export type OfflineCard = { id: number; question: string; answer: string };
export type OfflineNote = { id: number; title: string; content: string };

export type OfflinePack = {
  recordingId: number;
  /** Packs belong to the account that saved them; another account on the same browser never sees them. */
  userId: number;
  title: string;
  savedAt: number;
  segments: OfflineSegment[];
  /** Used when there are no segments, or the transcript was edited after transcription. */
  fullText: string;
  flashcards: OfflineCard[];
  notes: OfflineNote[];
};

export type QueuedReview = {
  id?: number;
  userId: number;
  recordingId: number;
  flashcardId: number;
  status: "learning" | "mastered";
  seconds: number;
  localDate: string;
  queuedAt: number;
};

type SegmentLike = { start?: unknown; speaker?: unknown; text?: unknown };

/** Keeps only what offline reading and review need, so a pack stays small and has no surprises. */
export function buildOfflinePack(input: {
  userId: number;
  recording: { id: number; title: string };
  transcript?: { fullText?: string | null; segments?: SegmentLike[] | null } | null;
  flashcards?: Array<{ id: number; question: string; answer: string }> | null;
  notes?: Array<{ id: number; title?: string | null; content?: string | null }> | null;
  now?: number;
}): OfflinePack {
  const segments: OfflineSegment[] = (input.transcript?.segments ?? [])
    .filter((s): s is SegmentLike & { text: string } => typeof s?.text === "string" && s.text.trim().length > 0)
    .map((s) => ({
      start: typeof s.start === "number" && Number.isFinite(s.start) ? s.start : 0,
      speaker: typeof s.speaker === "string" && s.speaker ? s.speaker : null,
      text: s.text.trim(),
    }));
  const fullText = (input.transcript?.fullText ?? "").trim();
  // An edited transcript changes fullText only; prefer it when the two have drifted apart, like the TXT export.
  const segmentText = segments.map((s) => s.text).join(" ");
  const useSegments = segments.length > 0 && normalise(segmentText) === normalise(fullText || segmentText);
  return {
    recordingId: input.recording.id,
    userId: input.userId,
    title: input.recording.title,
    savedAt: input.now ?? Date.now(),
    segments: useSegments ? segments : [],
    fullText,
    flashcards: (input.flashcards ?? []).map((c) => ({ id: c.id, question: c.question, answer: c.answer })),
    notes: (input.notes ?? [])
      .filter((n) => typeof n.content === "string" && n.content.trim())
      .map((n) => ({ id: n.id, title: n.title?.trim() || "Notes", content: n.content!.trim() })),
  };
}

function normalise(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A network failure (worth retrying later) as opposed to the server refusing the review. */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}
