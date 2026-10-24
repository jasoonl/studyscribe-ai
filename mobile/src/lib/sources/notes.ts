// Pasted notes become a plain .txt in the document directory and go through the same upload as a file.
// Mirrors notesToFile in client/src/lib/sourceUpload.ts; keep in step.

export const MIN_NOTES_CHARS = 20;

/** "<title>.txt" with characters iOS and the server dislike removed. */
export function notesFileName(title: string): string {
  const base =
    title
      .trim()
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Notes";
  return `${base}.txt`;
}

/** An error sentence for pasted notes that are too short, else null. */
export function notesProblem(text: string): string | null {
  return text.trim().length < MIN_NOTES_CHARS ? `Paste at least ${MIN_NOTES_CHARS} characters of notes.` : null;
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
