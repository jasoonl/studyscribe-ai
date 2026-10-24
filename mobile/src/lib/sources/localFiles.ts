import { Directory, File, Paths, UploadType } from "expo-file-system";
import { createUploadStore, type JournalFs } from "./uploadStore";
import { notesFileName } from "./notes";

/** Native file handling for study sources: files stay in the document directory (never the cache, which iOS may clear). */
const DIR = "source-uploads";

function dir() {
  const directory = new Directory(Paths.document, DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

const journalFs: JournalFs = {
  read() {
    const file = new File(Paths.document, DIR, "journal.json");
    return file.exists ? file.textSync() : null;
  },
  write(text) {
    dir();
    new File(Paths.document, DIR, "journal.json").write(text);
  },
  remove() {
    const file = new File(Paths.document, DIR, "journal.json");
    if (file.exists) file.delete();
  },
};

export const uploadStore = createUploadStore(journalFs);

function uniqueName(rowId: string, name: string) {
  return `${rowId}-${name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80)}`;
}

/** Copies a picked file out of the cache. Falls back to the original location if the copy fails. */
export function keepSourceFile(uri: string, rowId: string, name: string): string {
  try {
    const target = new File(dir(), uniqueName(rowId, name));
    new File(uri).copy(target);
    return target.uri;
  } catch {
    return uri;
  }
}

/** Writes pasted notes to a .txt and returns its location and size. */
export function writeNotesFile(rowId: string, title: string, text: string): { uri: string; name: string; size: number } {
  const name = notesFileName(title);
  const target = new File(dir(), uniqueName(rowId, name));
  target.write(text);
  return { uri: target.uri, name, size: target.size ?? 0 };
}

export function deleteLocalFile(uri: string) {
  try {
    if (!uri) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

export function localFileSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

export function localFileExists(uri: string) {
  try {
    return !!uri && new File(uri).exists;
  } catch {
    return false;
  }
}

/** Sends the file in one PUT as a native upload task. The signal cancels it. */
export async function putSourceFile(uri: string, url: string, contentType: string, onProgress: (sent: number) => void, signal: AbortSignal) {
  const result = await new File(uri).upload(url, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
    onProgress: ({ bytesSent }) => onProgress(bytesSent),
    signal,
  });
  return { status: result.status };
}
