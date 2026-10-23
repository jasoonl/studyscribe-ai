/**
 * Study source upload helpers: file checks, the PUT with real progress, pasted notes as a file,
 * and the client-driven pipeline (extract, analyse each part two at a time, finalize).
 * Pure where it can be (the server calls are injected) so the queue and abort behaviour is tested.
 */

export type SourceLimits = { maxBytes: number; maxTextBytes: number; extensions: string[] };

export type SourceFileError = "unsupportedType" | "legacyType" | "empty" | "tooLarge";

const LEGACY_EXTENSIONS = ["doc", "ppt", "xls", "xlsx", "rtf", "odt", "odp"];
const TEXT_EXTENSIONS = ["txt", "md", "markdown"];

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

/** The first problem with a file, found before anything is uploaded; null when it can be sent. */
export function validateSourceFile(file: { name: string; size: number }, limits: SourceLimits): SourceFileError | null {
  const extension = fileExtension(file.name);
  if (LEGACY_EXTENSIONS.includes(extension)) return "legacyType";
  if (!limits.extensions.includes(extension)) return "unsupportedType";
  if (file.size <= 0) return "empty";
  const cap = TEXT_EXTENSIONS.includes(extension) ? limits.maxTextBytes : limits.maxBytes;
  if (file.size > cap) return "tooLarge";
  return null;
}

/** Value for the file input's `accept` attribute. */
export function acceptAttribute(extensions: string[]): string {
  return extensions.map(extension => `.${extension}`).join(",");
}

/** Pasted notes go through the same upload as any file: a plain text File named after the title. */
export function notesToFile(title: string, text: string): File {
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Notes";
  return new File([text], `${base}.txt`, { type: "text/plain" });
}

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

type XhrLike = Pick<XMLHttpRequest, "open" | "setRequestHeader" | "send" | "abort" | "upload" | "status" | "responseText"> & {
  onload: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
};

/** PUTs a blob to a presigned URL with XMLHttpRequest, because fetch cannot report upload progress. */
export function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal; createRequest?: () => XhrLike } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) return reject(new UploadAbortedError());
    const request = options.createRequest ? options.createRequest() : (new XMLHttpRequest() as unknown as XhrLike);
    const onAbort = () => request.abort();
    const done = () => options.signal?.removeEventListener("abort", onAbort);

    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      done();
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`The upload was refused (${request.status})`));
      }
    };
    request.onerror = () => {
      done();
      reject(new Error("The connection dropped during the upload"));
    };
    request.onabort = () => {
      done();
      reject(new UploadAbortedError());
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    request.send(body);
  });
}

export type PreparedSourceUpload = { key: string; uploadUrl: string; uploadContentType: string };

export async function uploadSourceDirectly(
  file: File,
  prepared: PreparedSourceUpload,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal; createRequest?: () => XhrLike } = {},
): Promise<void> {
  // Re-wrap so the body's own type matches the header the URL was signed for.
  const body = new Blob([file], { type: prepared.uploadContentType });
  await putWithProgress(prepared.uploadUrl, body, prepared.uploadContentType, options);
}

// ---- Pipeline ----------------------------------------------------------------------------

export type PipelineApi = {
  extract(id: number): Promise<{ partCount: number }>;
  analyzePart(id: number, index: number): Promise<void>;
  finalize(id: number): Promise<void>;
};

export type PipelineStage = { stage: "reading" } | { stage: "summarizing"; done: number; total: number } | { stage: "finishing" };

/** Where a source stands on the server, enough to continue after a reload. */
export type ResumePoint = { status: string; partCount: number; doneParts: number[] };

/** Indexes of parts still to analyse. */
export function remainingParts(partCount: number, doneParts: readonly number[]): number[] {
  const done = new Set(doneParts);
  return Array.from({ length: Math.max(0, partCount) }, (_, index) => index).filter(index => !done.has(index));
}

/** Runs `worker` over `items` with at most `limit` in flight; stops at the first failure or abort. */
export async function mapPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  let failed = false;
  const lane = async () => {
    while (!failed) {
      if (signal?.aborted) throw new UploadAbortedError();
      const index = next++;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failed) throw failure;
  if (signal?.aborted) throw new UploadAbortedError();
}

/**
 * extract, analyse every part (two in flight), then finalize. With a resume point it skips what
 * the server already holds, so a reload or a retry continues instead of starting over.
 */
export async function runSourcePipeline(
  api: PipelineApi,
  id: number,
  options: { signal?: AbortSignal; onStage?: (stage: PipelineStage) => void; resume?: ResumePoint; concurrency?: number } = {},
): Promise<void> {
  const { signal, onStage, resume } = options;
  const check = () => {
    if (signal?.aborted) throw new UploadAbortedError();
  };
  if (resume?.status === "ready") return;

  let partCount = resume?.partCount ?? 0;
  let doneParts = resume?.doneParts ?? [];
  const needsExtract = !resume || resume.status === "uploaded" || resume.status === "extracting" || resume.status === "failed";
  if (needsExtract) {
    onStage?.({ stage: "reading" });
    check();
    partCount = (await api.extract(id)).partCount;
    doneParts = [];
  }

  const todo = remainingParts(partCount, doneParts);
  let done = partCount - todo.length;
  onStage?.({ stage: "summarizing", done, total: partCount });
  await mapPool(
    todo,
    options.concurrency ?? 2,
    async index => {
      check();
      await api.analyzePart(id, index);
      done += 1;
      onStage?.({ stage: "summarizing", done, total: partCount });
    },
    signal,
  );

  check();
  onStage?.({ stage: "finishing" });
  await api.finalize(id);
}

// ---- Polling -----------------------------------------------------------------------------

export const SOURCE_POLL_MS = 4000;
export const SOURCE_POLL_GIVE_UP_MS = 15 * 60 * 1000;

const WORKING = new Set(["uploaded", "extracting", "extracted", "analyzing"]);

export function isWorkingStatus(status: string): boolean {
  return WORKING.has(status);
}

/**
 * How often the library list refreshes: only while some source is mid-pipeline (another tab or a
 * run before a reload may be driving it), and not for ever.
 */
export function pollIntervalFor(statuses: readonly string[], watchedForMs: number): number | false {
  if (!statuses.some(isWorkingStatus)) return false;
  return watchedForMs >= SOURCE_POLL_GIVE_UP_MS ? false : SOURCE_POLL_MS;
}

/** A source that is mid-pipeline but untouched for a while has no tab driving it: offer Continue. */
export const SOURCE_STALE_MS = 2 * 60 * 1000;

export function isStalled(source: { status: string; updatedAt: string | Date }, now: number): boolean {
  if (!isWorkingStatus(source.status)) return false;
  return now - new Date(source.updatedAt).getTime() > SOURCE_STALE_MS;
}
