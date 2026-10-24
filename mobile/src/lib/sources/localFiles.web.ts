import { createUploadStore, type JournalFs } from "./uploadStore";
import { notesFileName } from "./notes";

/** Web preview (react-native-web): files are blob: URLs that do not survive a reload; the journal lives in localStorage. */
const KEY = "studyscribe.source-uploads";

const journalFs: JournalFs = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (text) => {
    try {
      localStorage.setItem(KEY, text);
    } catch {
      // Storage blocked.
    }
  },
  remove: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage blocked.
    }
  },
};

export const uploadStore = createUploadStore(journalFs);

export function keepSourceFile(uri: string, _rowId: string, _name: string): string {
  return uri;
}

export function writeNotesFile(_rowId: string, title: string, text: string): { uri: string; name: string; size: number } {
  const blob = new Blob([text], { type: "text/plain" });
  return { uri: URL.createObjectURL(blob), name: notesFileName(title), size: blob.size };
}

export function deleteLocalFile(_uri: string) {}

export function localFileSize(_uri: string): number {
  return 0;
}

export function localFileExists(uri: string) {
  return !!uri;
}

export async function putSourceFile(uri: string, url: string, contentType: string, onProgress: (sent: number) => void, signal: AbortSignal) {
  const body = await (await fetch(uri)).blob();
  const response = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body, signal });
  onProgress(body.size);
  return { status: response.status };
}
