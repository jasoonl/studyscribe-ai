/**
 * The upload journal: what is still in flight, written to the document directory after every
 * transition so a relaunch can continue (same idea as the recorder journal). Pure logic with an
 * injected file system; the native one is in localFiles.ts.
 */

import type { UploadRowError } from "./errors";

export type JobStage = "waiting" | "uploading" | "saving" | "pipeline";

export type StoredJob = {
  rowId: string;
  /** Local copy of the file (empty for a job that only continues an existing source). */
  uri: string;
  name: string;
  size: number;
  courseId: number | null;
  /** Storage key once the PUT finished. */
  key?: string;
  /** Source id once registered. */
  sourceId?: number;
  stage: JobStage;
  /** The last attempt ended in an error the person can retry. */
  errored?: boolean;
  /** Why it stopped, so a relaunch shows the right sentence. Older entries only have `errored`. */
  error?: UploadRowError;
};

const ERROR_KINDS = ["reason", "usageLimit", "rateLimited", "stillReading", "notSetUp", "offline", "paused", "message"];

/** The row error to restore for a saved job, or null when it did not stop on an error. */
export function restoredError(job: Pick<StoredJob, "errored" | "error">): UploadRowError | null {
  if (job.error) return job.error;
  return job.errored ? { kind: "paused" } : null;
}

function isStoredError(value: unknown): value is UploadRowError {
  return !!value && typeof value === "object" && ERROR_KINDS.includes((value as { kind?: unknown }).kind as string);
}

export type StoredJournal = { userId: number; jobs: StoredJob[] };

export type JournalFs = { read(): string | null; write(text: string): void; remove(): void };

export type NextStep = "prepare" | "register" | "pipeline" | "drop";

/** Where a job picks up. A job with neither a file nor a source cannot go on. */
export function nextStepFor(job: Pick<StoredJob, "uri" | "key" | "sourceId">): NextStep {
  if (job.sourceId) return "pipeline";
  if (!job.uri) return "drop";
  if (job.key) return "register";
  return "prepare";
}

function isJob(value: unknown): value is StoredJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.rowId === "string" &&
    typeof job.uri === "string" &&
    typeof job.name === "string" &&
    typeof job.size === "number" &&
    (job.courseId === null || typeof job.courseId === "number") &&
    (job.key === undefined || typeof job.key === "string") &&
    (job.sourceId === undefined || typeof job.sourceId === "number") &&
    typeof job.stage === "string" &&
    (job.error === undefined || isStoredError(job.error))
  );
}

export function createUploadStore(fs: JournalFs) {
  return {
    /** Jobs saved for this person; another person's journal is discarded. */
    load(userId: number): StoredJob[] {
      try {
        const raw = fs.read();
        if (!raw) return [];
        const parsed = JSON.parse(raw) as StoredJournal;
        if (!parsed || parsed.userId !== userId || !Array.isArray(parsed.jobs)) {
          if (parsed && parsed.userId !== userId) fs.remove();
          return [];
        }
        return parsed.jobs.filter(isJob).filter((job) => nextStepFor(job) !== "drop");
      } catch {
        return [];
      }
    },
    save(userId: number, jobs: readonly StoredJob[]) {
      try {
        if (jobs.length === 0) fs.remove();
        else fs.write(JSON.stringify({ userId, jobs: [...jobs] } satisfies StoredJournal));
      } catch {
        // A journal that cannot be written only costs the resume after a relaunch.
      }
    },
  };
}
