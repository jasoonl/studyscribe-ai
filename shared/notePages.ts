/** Standalone study notes (Phase 9): limits shared by the server checks and the editor. */
export const MAX_NOTE_PAGES_PER_USER = 500;
export const MAX_NOTE_TITLE_CHARS = 200;
export const MAX_NOTE_BODY_CHARS = 100_000;
export const NOTE_ORGANIZE_MODES = ["tidy", "summary", "questions"] as const;
export type NoteOrganizeMode = (typeof NOTE_ORGANIZE_MODES)[number];

/** What the editor shows when a note has no title yet. */
export function cleanNoteTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_TITLE_CHARS);
}

/** Applies an organized result to the current text. Replace swaps it, append adds it below. */
export function applyOrganized(current: string, generated: string, action: "replace" | "append"): string {
  const next = action === "replace" || !current.trim() ? generated.trim() : `${current.replace(/\s+$/, "")}\n\n${generated.trim()}`;
  return next.slice(0, MAX_NOTE_BODY_CHARS);
}

/** Replace would throw away anything typed after the AI call started from `base`. */
export function canReplaceAfterOrganize(currentBody: string, base: string): boolean {
  return currentBody === base;
}
