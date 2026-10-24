/**
 * Mirrors client/src/lib/sourceUpload.ts and sourceUploadQueue.ts (keep in step), minus the
 * browser pieces (XHR, File). File checks take { name, size }; the server calls are injected so
 * the queue, ordering, resume and abort behaviour is tested without a network.
 */
import type { SourceLimits } from "./model";
import type { UploadRowError } from "./errors";

// ---- File checks -------------------------------------------------------------------------

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

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

// ---- Pipeline ----------------------------------------------------------------------------

export type PipelineApi = {
  extract(id: number, signal?: AbortSignal): Promise<{ partCount: number }>;
  analyzePart(id: number, index: number): Promise<void>;
  finalize(id: number): Promise<void>;
};

export type PipelineStage = { stage: "reading" } | { stage: "summarizing"; done: number; total: number } | { stage: "finishing" };

/** Where a source stands on the server, enough to continue after a reload. */
export type ResumePoint = { status: string; partCount: number; doneParts: number[] };

/** Indexes of parts still to analyse. */
export function remainingParts(partCount: number, doneParts: readonly number[]): number[] {
  const done = new Set(doneParts);
  return Array.from({ length: Math.max(0, partCount) }, (_, index) => index).filter((index) => !done.has(index));
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
 * the server already holds, so a relaunch or a retry continues instead of starting over.
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
    partCount = (await api.extract(id, signal)).partCount;
    doneParts = [];
  }

  const todo = remainingParts(partCount, doneParts);
  let done = partCount - todo.length;
  onStage?.({ stage: "summarizing", done, total: partCount });
  await mapPool(
    todo,
    options.concurrency ?? 2,
    async (index) => {
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

// ---- Polling and staleness ---------------------------------------------------------------

export const SOURCE_POLL_MS = 4000;
export const SOURCE_POLL_GIVE_UP_MS = 15 * 60 * 1000;

const WORKING = new Set(["uploaded", "extracting", "extracted", "analyzing"]);

export function isWorkingStatus(status: string): boolean {
  return WORKING.has(status);
}

/** How often the library refreshes: only while a source is mid-pipeline, and not for ever. */
export function pollIntervalFor(statuses: readonly string[], watchedForMs: number): number | false {
  if (!statuses.some(isWorkingStatus)) return false;
  return watchedForMs >= SOURCE_POLL_GIVE_UP_MS ? false : SOURCE_POLL_MS;
}

/** A source that is mid-pipeline but untouched for a while has nothing driving it: offer Continue. */
export const SOURCE_STALE_MS = 2 * 60 * 1000;

export function isStalled(source: { status: string; updatedAt: string | Date }, now: number): boolean {
  if (!isWorkingStatus(source.status)) return false;
  return now - new Date(source.updatedAt).getTime() > SOURCE_STALE_MS;
}

// ---- Queue -------------------------------------------------------------------------------

export type QueueTask = (signal: AbortSignal) => Promise<void>;

export type UploadQueue = {
  add(id: string, task: QueueTask): void;
  abort(id: string): void;
  abortAll(): void;
  has(id: string): boolean;
  snapshot(): { running: string[]; waiting: string[] };
};

/** Runs at most `concurrency` tasks at once. A rejected task never stops the queue. */
export function createUploadQueue(options: { concurrency: number; onChange?: () => void }): UploadQueue {
  const concurrency = Math.max(1, options.concurrency);
  const waiting: { id: string; task: QueueTask }[] = [];
  const running = new Map<string, AbortController>();
  const changed = () => options.onChange?.();

  const pump = () => {
    while (running.size < concurrency && waiting.length > 0) {
      const next = waiting.shift()!;
      const controller = new AbortController();
      running.set(next.id, controller);
      void next
        .task(controller.signal)
        .catch(() => undefined)
        .finally(() => {
          running.delete(next.id);
          changed();
          pump();
        });
    }
    changed();
  };

  return {
    add(id, task) {
      if (running.has(id) || waiting.some((item) => item.id === id)) return;
      waiting.push({ id, task });
      pump();
    },
    abort(id) {
      const index = waiting.findIndex((item) => item.id === id);
      if (index >= 0) {
        waiting.splice(index, 1);
        changed();
        return;
      }
      running.get(id)?.abort();
    },
    abortAll() {
      waiting.length = 0;
      running.forEach((controller) => controller.abort());
      changed();
    },
    has: (id) => running.has(id) || waiting.some((item) => item.id === id),
    snapshot: () => ({ running: Array.from(running.keys()), waiting: waiting.map((item) => item.id) }),
  };
}

// ---- Rows (the provider's state, as a pure reducer) --------------------------------------

export type UploadStage = "waiting" | "uploading" | "saving" | "reading" | "summarizing" | "finishing" | "done" | "error";

export type UploadRow = {
  id: string;
  name: string;
  size: number;
  courseId: number | null;
  stage: UploadStage;
  /** 0 to 100 while uploading. */
  progress: number;
  partsDone: number;
  partsTotal: number;
  sourceId: number | null;
  error: UploadRowError | null;
  /** False for a file that was refused up front: there is nothing to try again. */
  canRetry: boolean;
};

export type UploadsAction =
  | { type: "reset" }
  | { type: "add"; rows: UploadRow[] }
  | { type: "patch"; id: string; change: Partial<UploadRow> }
  | { type: "remove"; id: string }
  | { type: "removeDone"; id: string };

export function uploadsReducer(rows: UploadRow[], action: UploadsAction): UploadRow[] {
  switch (action.type) {
    case "reset":
      return [];
    case "add": {
      const ids = new Set(action.rows.map((row) => row.id));
      return [...action.rows, ...rows.filter((row) => !ids.has(row.id))];
    }
    case "patch":
      return rows.map((row) => (row.id === action.id ? { ...row, ...action.change } : row));
    case "remove":
      return rows.filter((row) => row.id !== action.id);
    case "removeDone":
      return rows.filter((row) => !(row.id === action.id && row.stage === "done"));
  }
}

const MID_PIPELINE: readonly UploadStage[] = ["reading", "summarizing", "finishing"];

/**
 * Rows to start again when the app returns to the foreground: mid-pipeline rows that no queue
 * slot owns any more, and rows paused because the connection dropped. Server steps are
 * idempotent, so running one again is safe.
 */
export function rowsToResume(rows: readonly UploadRow[], isQueued: (id: string) => boolean): string[] {
  return rows
    .filter((row) => {
      if (isQueued(row.id)) return false;
      if (row.stage === "error") return row.canRetry && row.error?.kind === "offline";
      return MID_PIPELINE.includes(row.stage);
    })
    .map((row) => row.id);
}

/** The percent the row's bar shows, or null when the amount of work is not known yet. */
export function rowPercent(row: Pick<UploadRow, "stage" | "progress" | "partsDone" | "partsTotal">): number | null {
  switch (row.stage) {
    case "uploading":
      return Math.max(0, Math.min(100, Math.round(row.progress)));
    case "saving":
    case "finishing":
    case "done":
      return 100;
    case "summarizing":
      return row.partsTotal > 0 ? Math.min(99, Math.round((row.partsDone / row.partsTotal) * 100)) : null;
    default:
      return null;
  }
}

export function stageSentence(row: Pick<UploadRow, "stage" | "partsDone" | "partsTotal">): string {
  switch (row.stage) {
    case "waiting":
      return "Waiting";
    case "uploading":
      return "Uploading";
    case "saving":
      return "Saving";
    case "reading":
      return "Reading the file";
    case "summarizing":
      return row.partsTotal > 0 ? `Summarizing, part ${Math.min(row.partsDone + 1, row.partsTotal)} of ${row.partsTotal}` : "Summarizing";
    case "finishing":
      return "Finishing";
    case "done":
      return "Ready";
    default:
      return "Needs attention";
  }
}

// ---- Cancelling, sizes and polling windows -----------------------------------------------

/**
 * What cancelling a row does to the source behind it. Only an upload started from this screen
 * (not a `resume-` row, which continues a source that was already in the library) and not a
 * row that already failed (Dismiss) may delete a source; a running task removes it itself once
 * it has stopped, because a register request may still be in flight.
 */
export function cancelPlan(input: { rowId: string; stage: UploadStage; sourceId: number | null; running: boolean }): "none" | "removeNow" | "removeAfterAbort" {
  if (input.rowId.startsWith("resume-") || input.stage === "error" || input.stage === "done") return "none";
  if (input.running) return "removeAfterAbort";
  return input.sourceId !== null ? "removeNow" : "none";
}

/** The picker may not report a size; the copied file knows the real one. */
export function effectiveSize(reported: number | null | undefined, actual: number | null | undefined): number {
  if (actual && actual > 0) return actual;
  return reported && reported > 0 ? reported : 0;
}

/** Part indexes the server already holds, from `sources.get`. */
export function doneParts(parts: readonly { index: number; done: boolean }[]): number[] {
  return parts.filter((part) => part.done).map((part) => part.index);
}

/** The start of the polling window: restarts when work newly appears, so a later upload is watched too. */
export function watchStartFor(input: { working: boolean; wasWorking: boolean; watchedSince: number; now: number }): number {
  return input.working && !input.wasWorking ? input.now : input.watchedSince;
}
