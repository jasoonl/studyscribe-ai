import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { useSession } from "@/lib/SessionProvider";
import { trpc } from "@/lib/trpc";
import { deleteLocalFile, keepSourceFile, localFileExists, localFileSize, putSourceFile, uploadStore, writeNotesFile } from "./localFiles";
import { describeError, isRetryableError, rowErrorText, SourceFailedError, SourceStillReadingError } from "./errors";
import { SOURCE_LIMITS, type SourceKind } from "./model";
import {
  UploadAbortedError,
  cancelPlan,
  createUploadQueue,
  doneParts,
  effectiveSize,
  rowsToResume,
  runSourcePipeline,
  uploadsReducer,
  validateSourceFile,
  type PipelineApi,
  type UploadRow,
} from "./pipeline";
import type { PickedSource } from "./pickSources";
import { nextStepFor, restoredError, type StoredJob } from "./uploadStore";

export type { UploadRow, UploadStage } from "./pipeline";
export type { UploadRowError } from "./errors";

const CONCURRENCY = 2;
let counter = 0;

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

type ResumeInput = { id: number; title: string; sizeBytes: number; courseId: number | null; kind: SourceKind };

type Value = {
  rows: UploadRow[];
  addFiles: (files: PickedSource[], courseId: number | null) => void;
  addNotes: (title: string, text: string, courseId: number | null) => void;
  retry: (rowId: string) => void;
  /** Cancels a row. A source already created from it is removed too. */
  remove: (rowId: string) => void;
  /** Continues a source left mid-pipeline, or retries a failed one, from where the server holds it. */
  resume: (source: ResumeInput) => void;
  active: boolean;
};

const Context = createContext<Value | null>(null);

/**
 * The upload queue for the whole app, mounted above the navigator like the recorder, so a file
 * keeps going while the person opens a source or leaves the course. Steps: check the file,
 * prepareUpload, one native PUT, register, then the server pipeline (extract, analyse parts two
 * at a time, finalize). Every transition is journaled, so a relaunch continues from the step
 * the job reached. Server steps are idempotent, so running one twice is safe.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const { state: session } = useSession();
  const userId = session.status === "signedIn" ? session.user.id : null;
  const [rows, dispatch] = useReducer(uploadsReducer, [] as UploadRow[]);
  const rowsRef = useRef<UploadRow[]>([]);
  rowsRef.current = rows;
  const jobs = useRef(new Map<string, StoredJob>());
  const client = utils.client;
  const loaded = useRef<number | null>(null);
  /** The person signed in right now. A task started for someone else must never write their journal into this one. */
  const userRef = useRef<number | null>(userId);
  userRef.current = userId;
  /** Rows the person cancelled while a task was running: that task deletes the source it created once it has stopped. */
  const cancelled = useRef(new Set<string>());

  const persist = useCallback((owner: number | null = userRef.current) => {
    if (owner === null || owner !== userRef.current) return;
    uploadStore.save(owner, Array.from(jobs.current.values()));
  }, []);

  const patch = useCallback((id: string, change: Partial<UploadRow>) => dispatch({ type: "patch", id, change }), []);
  const queue = useMemo(() => createUploadQueue({ concurrency: CONCURRENCY }), []);

  const refresh = useCallback(() => {
    void utils.sources.list.invalidate();
    void utils.sources.get.invalidate();
  }, [utils]);

  const api: PipelineApi = useMemo(
    () => ({
      extract: async (id, signal) => {
        let source = await client.sources.extract.mutate({ id });
        // Another request is reading it: wait for it instead of starting over.
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
      finalize: async (id) => {
        await client.sources.finalize.mutate({ id });
      },
    }),
    [client],
  );

  const runPipeline = useCallback(
    async (rowId: string, sourceId: number, signal: AbortSignal) => {
      const detail = await client.sources.get.query({ id: sourceId });
      const current = detail.source;
      let status: string = current.status;
      let partCount = current.partCount;
      let done = doneParts(detail.parts);
      if (status === "failed") {
        const reset = await client.sources.retry.mutate({ id: sourceId });
        status = reset.status;
        partCount = reset.partCount;
        done = [];
        refresh();
      }
      if (status === "ready") return;
      await runSourcePipeline(api, sourceId, {
        signal,
        resume: { status, partCount, doneParts: done },
        onStage: (stage) => {
          if (stage.stage === "reading") patch(rowId, { stage: "reading" });
          else if (stage.stage === "summarizing") patch(rowId, { stage: "summarizing", partsDone: stage.done, partsTotal: stage.total });
          else patch(rowId, { stage: "finishing" });
        },
      });
    },
    [api, client, patch, refresh],
  );

  const finishJob = useCallback(
    (rowId: string, owner: number | null = userRef.current) => {
      const job = jobs.current.get(rowId);
      if (job) deleteLocalFile(job.uri);
      jobs.current.delete(rowId);
      persist(owner);
    },
    [persist],
  );

  const execute = useCallback(
    async (rowId: string, signal: AbortSignal) => {
      const job = jobs.current.get(rowId);
      if (!job) return;
      const owner = userRef.current;
      const uploaded = !rowId.startsWith("resume-");
      const stopIfAborted = () => {
        if (signal.aborted || owner !== userRef.current) throw new UploadAbortedError();
      };
      try {
        job.errored = false;
        delete job.error;
        if (nextStepFor(job) === "prepare") {
          patch(rowId, { stage: "uploading", error: null, progress: 0 });
          job.stage = "uploading";
          persist(owner);
          const prepared = await client.sources.prepareUpload.mutate({ fileName: job.name, size: job.size, courseId: job.courseId ?? undefined });
          stopIfAborted();
          const result = await putSourceFile(
            job.uri,
            prepared.uploadUrl,
            prepared.uploadContentType,
            (sent) => patch(rowId, { progress: job.size > 0 ? Math.min(100, (sent / job.size) * 100) : 0 }),
            signal,
          );
          stopIfAborted();
          if (result.status < 200 || result.status >= 300) throw new Error(`The upload was refused (${result.status}).`);
          job.key = prepared.key;
          persist(owner);
        }
        if (nextStepFor(job) === "register") {
          stopIfAborted();
          patch(rowId, { stage: "saving", progress: 100, error: null });
          job.stage = "saving";
          persist(owner);
          const registered = await client.sources.register.mutate({ key: job.key!, fileName: job.name, courseId: job.courseId ?? undefined });
          job.sourceId = registered.id;
          job.stage = "pipeline";
          persist(owner);
          patch(rowId, { sourceId: registered.id });
          refresh();
          // Cancelled while the request was in flight: the source exists now, so the abort handler below removes it.
          stopIfAborted();
        }
        patch(rowId, { stage: "reading", error: null });
        job.stage = "pipeline";
        persist(owner);
        await runPipeline(rowId, job.sourceId as number, signal);
        patch(rowId, { stage: "done" });
        AccessibilityInfo.announceForAccessibility(`${job.name} is ready`);
        finishJob(rowId, owner);
        setTimeout(() => dispatch({ type: "removeDone", id: rowId }), 6_000);
      } catch (error) {
        if (error instanceof UploadAbortedError || signal.aborted) {
          dispatch({ type: "remove", id: rowId });
          finishJob(rowId, owner);
          // The person cancelled an upload they started: take away the half-made source (never one that was already in the library).
          if (uploaded && cancelled.current.delete(rowId) && job.sourceId !== undefined && owner === userRef.current) {
            client.sources.remove
              .mutate({ id: job.sourceId })
              .catch(() => undefined)
              .finally(refresh);
          }
        } else {
          const described = describeError(error);
          patch(rowId, { stage: "error", error: described, canRetry: isRetryableError(described) });
          if (isRetryableError(described)) {
            job.errored = true;
            job.error = described;
            persist(owner);
          } else {
            // A failure the file itself caused: the library shows it on the source; nothing to resume.
            finishJob(rowId, owner);
          }
        }
      } finally {
        refresh();
      }
    },
    [client, finishJob, patch, persist, refresh, runPipeline],
  );

  const enqueue = useCallback((rowId: string) => queue.add(rowId, (signal) => execute(rowId, signal)), [execute, queue]);

  const startRows = useCallback(
    (added: UploadRow[], stored: StoredJob[]) => {
      for (const job of stored) jobs.current.set(job.rowId, job);
      persist();
      rowsRef.current = uploadsReducer(rowsRef.current, { type: "add", rows: added });
      dispatch({ type: "add", rows: added });
      for (const row of added) if (row.stage === "waiting") enqueue(row.id);
    },
    [enqueue, persist],
  );

  const newRow = (id: string, name: string, size: number, courseId: number | null, extra: Partial<UploadRow> = {}): UploadRow => ({
    id,
    name,
    size,
    courseId,
    stage: "waiting",
    progress: 0,
    partsDone: 0,
    partsTotal: 0,
    sourceId: null,
    error: null,
    canRetry: true,
    ...extra,
  });

  const addFiles = useCallback(
    (picked: PickedSource[], courseId: number | null) => {
      const added: UploadRow[] = [];
      const stored: StoredJob[] = [];
      const refuse = (id: string, file: { name: string; size: number }, code: NonNullable<ReturnType<typeof validateSourceFile>>) =>
        added.push(newRow(id, file.name, file.size, courseId, { stage: "error", error: { kind: "file", code }, canRetry: false }));
      for (const file of picked) {
        const id = `source-upload-${Date.now()}-${counter++}`;
        // Type and size checks that need no copy; a picker that reports no size is judged by the copy below.
        const early = validateSourceFile({ name: file.name, size: file.size > 0 ? file.size : 1 }, SOURCE_LIMITS);
        if (early) {
          refuse(id, file, early);
          continue;
        }
        const uri = keepSourceFile(file.uri, id, file.name);
        const size = effectiveSize(file.size, localFileSize(uri));
        const problem = validateSourceFile({ name: file.name, size }, SOURCE_LIMITS);
        if (problem) {
          if (uri !== file.uri) deleteLocalFile(uri);
          refuse(id, { name: file.name, size }, problem);
          continue;
        }
        added.push(newRow(id, file.name, size, courseId));
        stored.push({ rowId: id, uri, name: file.name, size, courseId, stage: "waiting" });
      }
      if (added.length > 0) startRows(added, stored);
    },
    [startRows],
  );

  const addNotes = useCallback(
    (title: string, text: string, courseId: number | null) => {
      const id = `source-upload-${Date.now()}-${counter++}`;
      const file = writeNotesFile(id, title, text);
      const problem = validateSourceFile(file, SOURCE_LIMITS);
      if (problem) {
        deleteLocalFile(file.uri);
        startRows([newRow(id, file.name, file.size, courseId, { stage: "error", error: { kind: "file", code: problem }, canRetry: false })], []);
        return;
      }
      startRows([newRow(id, file.name, file.size, courseId)], [{ rowId: id, uri: file.uri, name: file.name, size: file.size, courseId, stage: "waiting" }]);
    },
    [startRows],
  );

  const retry = useCallback(
    (rowId: string) => {
      const row = rowsRef.current.find((item) => item.id === rowId);
      if (!row || !row.canRetry || !jobs.current.has(rowId) || queue.has(rowId)) return;
      patch(rowId, { stage: "waiting", error: null });
      enqueue(rowId);
    },
    [enqueue, patch, queue],
  );

  const remove = useCallback(
    (rowId: string) => {
      const row = rowsRef.current.find((item) => item.id === rowId);
      const sourceId = jobs.current.get(rowId)?.sourceId ?? row?.sourceId ?? null;
      const plan = cancelPlan({ rowId, stage: row?.stage ?? "error", sourceId, running: queue.has(rowId) && row?.stage !== "waiting" });
      if (plan === "removeAfterAbort") cancelled.current.add(rowId);
      queue.abort(rowId);
      dispatch({ type: "remove", id: rowId });
      finishJob(rowId);
      if (plan === "removeNow" && sourceId !== null) {
        client.sources.remove
          .mutate({ id: sourceId })
          .catch(() => undefined)
          .finally(refresh);
      }
    },
    [client, finishJob, queue, refresh],
  );

  const resume = useCallback(
    (source: ResumeInput) => {
      const rowId = `resume-${source.id}`;
      const existing = rowsRef.current.find((row) => row.id === rowId);
      if (existing && existing.stage !== "error" && existing.stage !== "done") return;
      const job: StoredJob = { rowId, uri: "", name: source.title, size: source.sizeBytes, courseId: source.courseId, sourceId: source.id, stage: "pipeline" };
      startRows([newRow(rowId, source.title, source.sizeBytes, source.courseId, { progress: 100, sourceId: source.id })], [job]);
    },
    [startRows],
  );

  // A different person (or nobody) is signed in: stop everything that belongs to the last one, forget their rows and
  // jobs and delete their local copies, so nothing of theirs is shown, saved under or sent with the new session.
  // Then continue what the journal holds for the new person: jobs that ended in an error come back paused with a
  // Retry; the rest start, each from the step it reached.
  useEffect(() => {
    if (loaded.current !== userId) {
      queue.abortAll();
      for (const job of jobs.current.values()) deleteLocalFile(job.uri);
      jobs.current.clear();
      cancelled.current.clear();
      rowsRef.current = [];
      dispatch({ type: "reset" });
      loaded.current = null;
    }
    if (userId === null || loaded.current === userId) return;
    loaded.current = userId;
    const saved = uploadStore.load(userId).filter((job) => job.sourceId || localFileExists(job.uri));
    if (saved.length === 0) return;
    const added = saved.map((job) => {
      const error = restoredError(job);
      return newRow(job.rowId, job.name, job.size, job.courseId, {
        sourceId: job.sourceId ?? null,
        progress: job.key || job.sourceId ? 100 : 0,
        stage: error ? "error" : "waiting",
        error,
      });
    });
    startRows(added, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Returning to the foreground: steps that were suspended mid-flight start again.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      for (const id of rowsToResume(rowsRef.current, (rowId) => queue.has(rowId))) {
        if (!jobs.current.has(id)) continue;
        patch(id, { stage: "waiting", error: null });
        enqueue(id);
      }
    });
    return () => subscription.remove();
  }, [enqueue, patch, queue]);

  useEffect(() => () => queue.abortAll(), [queue]);

  const active = rows.some((row) => row.stage !== "done" && row.stage !== "error");
  const value = useMemo(() => ({ rows, addFiles, addNotes, retry, remove, resume, active }), [rows, addFiles, addNotes, retry, remove, resume, active]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSourceUploads(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("useSourceUploads needs UploadsProvider");
  return value;
}

export { rowErrorText };
