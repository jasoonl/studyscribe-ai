import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { SOURCE_LIMITS, failureReasonOf, type FailureReason, type SourceKind, type SourceSummary } from "@/lib/sourceModel";
import { createUploadQueue } from "@/lib/sourceUploadQueue";
import {
  UploadAbortedError,
  notesToFile,
  runSourcePipeline,
  uploadSourceDirectly,
  validateSourceFile,
  type PipelineApi,
  type SourceFileError,
} from "@/lib/sourceUpload";
import { offerUpgradeOnUsageLimit, usageLimitOf } from "@/lib/usageLimit";

export type UploadStage = "waiting" | "uploading" | "saving" | "reading" | "summarizing" | "finishing" | "done" | "error";

export type UploadRowError =
  | { kind: "file"; code: SourceFileError }
  | { kind: "reason"; code: FailureReason }
  | { kind: "usageLimit" }
  | { kind: "rateLimited" }
  | { kind: "stillReading" }
  | { kind: "notSetUp" }
  | { kind: "message"; text: string };

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

const CONCURRENCY = 2;
let counter = 0;

/** The server marked the source failed while reading it; its short sentence says why. */
export class SourceFailedError extends Error {
  constructor(
    message: string | null,
    readonly kind?: SourceKind,
  ) {
    super(message ?? "This file could not be read");
    this.name = "SourceFailedError";
  }
}

/** Another request is still reading the source. Trying again waits for it. */
export class SourceStillReadingError extends Error {
  constructor() {
    super("This file is still being read");
    this.name = "SourceStillReadingError";
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadAbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The server's plain cap sentences; shown as written (they name no plan or price). */
const CAP_SENTENCE = /keep up to|storage limit|can hold up to|storage is nearly full/i;

/** Turns whatever went wrong into a row error. A refused request (429, a plan limit) stays resumable. */
export function describeError(error: unknown): UploadRowError {
  if (usageLimitOf(error)) return { kind: "usageLimit" };
  if (error instanceof SourceFailedError) return { kind: "reason", code: failureReasonOf(error.message, error.kind) };
  if (error instanceof SourceStillReadingError) return { kind: "stillReading" };
  const message = error instanceof Error ? error.message : "";
  if (/not set up on this server/i.test(message)) return { kind: "notSetUp" };
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | undefined)?.code;
    if (code === "TOO_MANY_REQUESTS") return { kind: "rateLimited" };
    if (message && CAP_SENTENCE.test(message)) return { kind: "message", text: message };
    const reason = failureReasonOf(message);
    if (reason !== "failed") return { kind: "reason", code: reason };
    // Other plain BAD_REQUEST sentences are safe to show too.
    if (code === "BAD_REQUEST" && message) return { kind: "message", text: message };
    if (message && /sources? (in|per)|keep up to|storage/i.test(message)) return { kind: "message", text: message };
  }
  return { kind: "reason", code: "failed" };
}

type ResumeInput = Pick<SourceSummary, "id" | "title" | "sizeBytes" | "courseId" | "kind">;

type Value = {
  rows: UploadRow[];
  addFiles: (files: File[], courseId: number | null) => void;
  addNotes: (title: string, text: string, courseId: number | null) => void;
  retry: (rowId: string) => void;
  remove: (rowId: string) => void;
  /** Continues a source left mid-pipeline, or retries a failed one, from where the server holds it. */
  resume: (source: ResumeInput) => void;
  active: boolean;
};

const Context = createContext<Value | null>(null);

/**
 * The upload queue for the whole app, mounted above the router like the recorder: a file keeps
 * uploading while the person opens a source or goes back to the course. Each file is checked,
 * uploaded with real progress, registered, then the server pipeline runs (extract, analyse parts
 * two at a time, finalize). The stored status lives on the server, so any step can be picked up
 * again after a failure, a refused request or a reload.
 */
export function SourceUploadsProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const files = useRef(new Map<string, File>());
  /** Storage keys of files already sent, so a retry after a refused register does not upload twice. */
  const sent = useRef(new Map<string, string>());
  const rowsRef = useRef<UploadRow[]>([]);
  rowsRef.current = rows;

  const patch = useCallback((id: string, change: Partial<UploadRow>) => {
    setRows(current => current.map(row => (row.id === id ? { ...row, ...change } : row)));
  }, []);

  const queue = useMemo(() => createUploadQueue({ concurrency: CONCURRENCY }), []);
  const client = utils.client;

  const api: PipelineApi = useMemo(
    () => ({
      extract: async (id, signal) => {
        let source = await client.sources.extract.mutate({ id });
        // Another request is reading it (a second tab): wait for it instead of starting over.
        for (let waited = 0; source.status === "extracting" && waited < 60_000; waited += 3_000) {
          await sleep(3_000, signal);
          source = (await client.sources.get.query({ id })).source;
        }
        if (source.status === "failed") throw new SourceFailedError(source.errorMessage, source.kind);
        if (source.status === "extracting" || source.status === "uploaded") throw new SourceStillReadingError();
        return { partCount: source.partCount };
      },
      analyzePart: async (id, index) => {
        await client.sources.analyzePart.mutate({ id, index });
      },
      finalize: async id => {
        await client.sources.finalize.mutate({ id });
      },
    }),
    [client],
  );

  const refresh = useCallback(() => {
    void utils.sources.list.invalidate();
    void utils.sources.get.invalidate();
  }, [utils]);

  const runPipeline = useCallback(
    async (rowId: string, sourceId: number, signal: AbortSignal) => {
      // Ask the server where the source stands; a failed one is reset first, so a retry re-reads it.
      const current = (await client.sources.get.query({ id: sourceId })).source;
      let status: string = current.status;
      let partCount = current.partCount;
      if (status === "failed") {
        const reset = await client.sources.retry.mutate({ id: sourceId });
        status = reset.status;
        partCount = reset.partCount;
        refresh();
      }
      if (status === "ready") return;
      await runSourcePipeline(api, sourceId, {
        signal,
        resume: { status, partCount, doneParts: [] },
        onStage: stage => {
          if (stage.stage === "reading") patch(rowId, { stage: "reading" });
          else if (stage.stage === "summarizing") patch(rowId, { stage: "summarizing", partsDone: stage.done, partsTotal: stage.total });
          else patch(rowId, { stage: "finishing" });
        },
      });
    },
    [api, client, patch, refresh],
  );

  const execute = useCallback(
    async (rowId: string, signal: AbortSignal) => {
      const row = rowsRef.current.find(item => item.id === rowId);
      const file = files.current.get(rowId);
      if (!row || (!file && row.sourceId === null)) return;
      try {
        let sourceId = row.sourceId;
        if (sourceId === null && file) {
          patch(rowId, { stage: "uploading", error: null });
          let key = sent.current.get(rowId);
          if (!key) {
            patch(rowId, { progress: 0 });
            const upload = await client.sources.prepareUpload.mutate({ fileName: file.name, size: file.size, courseId: row.courseId ?? undefined });
            await uploadSourceDirectly(file, upload, { signal, onProgress: progress => patch(rowId, { progress }) });
            key = upload.key;
            sent.current.set(rowId, key);
          }
          patch(rowId, { stage: "saving", progress: 100 });
          const registered = await client.sources.register.mutate({ key, fileName: file.name, courseId: row.courseId ?? undefined });
          sourceId = registered.id;
          sent.current.delete(rowId);
          patch(rowId, { sourceId });
          refresh();
        }
        patch(rowId, { stage: "reading", error: null });
        await runPipeline(rowId, sourceId as number, signal);
        patch(rowId, { stage: "done" });
        files.current.delete(rowId);
        // A finished row has done its job (the source now shows in the list); drop it soon after.
        setTimeout(() => setRows(current => current.filter(item => !(item.id === rowId && item.stage === "done"))), 8_000);
      } catch (error) {
        if (error instanceof UploadAbortedError || signal.aborted) {
          setRows(current => current.filter(item => item.id !== rowId));
          files.current.delete(rowId);
          sent.current.delete(rowId);
        } else {
          offerUpgradeOnUsageLimit(error);
          patch(rowId, { stage: "error", error: describeError(error) });
        }
      } finally {
        refresh();
      }
    },
    [client, patch, refresh, runPipeline],
  );

  const enqueue = useCallback((rowId: string) => queue.add(rowId, signal => execute(rowId, signal)), [execute, queue]);

  const addFiles = useCallback(
    (list: File[], courseId: number | null) => {
      const added: UploadRow[] = [];
      for (const file of list) {
        const id = `upload-${Date.now()}-${counter++}`;
        const problem = validateSourceFile(file, SOURCE_LIMITS);
        added.push({
          id,
          name: file.name,
          size: file.size,
          courseId,
          stage: problem ? "error" : "waiting",
          progress: 0,
          partsDone: 0,
          partsTotal: 0,
          sourceId: null,
          error: problem ? { kind: "file", code: problem } : null,
          canRetry: !problem,
        });
        if (!problem) files.current.set(id, file);
      }
      if (added.length === 0) return;
      // The rows must be in state before the queue starts them, since a task looks its row up.
      rowsRef.current = [...added, ...rowsRef.current];
      setRows(rowsRef.current);
      for (const row of added) if (row.stage === "waiting") enqueue(row.id);
    },
    [enqueue],
  );

  const addNotes = useCallback((title: string, text: string, courseId: number | null) => addFiles([notesToFile(title, text)], courseId), [addFiles]);

  const retry = useCallback(
    (rowId: string) => {
      const row = rowsRef.current.find(item => item.id === rowId);
      if (!row || !row.canRetry || (!files.current.has(rowId) && row.sourceId === null)) return;
      patch(rowId, { stage: "waiting", error: null });
      enqueue(rowId);
    },
    [enqueue, patch],
  );

  const remove = useCallback(
    (rowId: string) => {
      queue.abort(rowId);
      setRows(current => current.filter(row => row.id !== rowId));
      files.current.delete(rowId);
      sent.current.delete(rowId);
    },
    [queue],
  );

  const resume = useCallback(
    (source: ResumeInput) => {
      const rowId = `resume-${source.id}`;
      const existing = rowsRef.current.find(row => row.id === rowId);
      if (existing && existing.stage !== "error" && existing.stage !== "done") return;
      const row: UploadRow = {
        id: rowId,
        name: source.title,
        size: source.sizeBytes,
        courseId: source.courseId,
        stage: "waiting",
        progress: 100,
        partsDone: 0,
        partsTotal: 0,
        sourceId: source.id,
        error: null,
        canRetry: true,
      };
      rowsRef.current = [row, ...rowsRef.current.filter(item => item.id !== rowId)];
      setRows(rowsRef.current);
      enqueue(rowId);
    },
    [enqueue],
  );

  const active = rows.some(row => row.stage !== "done" && row.stage !== "error");
  // Closing the tab loses a file that is still going up; the server steps after it can resume.
  const uploading = rows.some(row => row.stage === "waiting" || row.stage === "uploading" || row.stage === "saving") && rows.some(row => files.current.has(row.id));

  useEffect(() => {
    if (!uploading) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [uploading]);

  useEffect(() => () => queue.abortAll(), [queue]);

  const value = useMemo(() => ({ rows, addFiles, addNotes, retry, remove, resume, active }), [rows, addFiles, addNotes, retry, remove, resume, active]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSourceUploads(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("useSourceUploads needs SourceUploadsProvider");
  return value;
}
