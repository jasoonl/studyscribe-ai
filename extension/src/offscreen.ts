import { uploadPresigned } from "@vercel/blob/client";
import { createApi } from "./lib/api";
import { RecordingBackup, createIdbBackupStore, newBackupId, staleBackups } from "./lib/backup";
import { describeError } from "./lib/worker";
import {
  isFromThisExtension,
  parseMessage,
  type CommandResponse,
  type OffscreenCommand,
  type RecorderEvent,
  type SaveOptions,
} from "./lib/messages";
import {
  assembleRecording,
  recordingFileName,
  recordingMimeType,
  uploadRecordingAudio,
  withSiteCredentials,
  type MultipartUploader,
} from "./lib/upload";

/**
 * The recorder. It lives in an offscreen document so it keeps running when
 * the popup closes. Tab audio comes from `chrome.tabCapture` (which mutes the
 * tab), so it is also played back through an AudioContext to stay audible.
 * The tab, and the microphone when asked for, feed one mix that MediaRecorder
 * records, like the web app's recorder. Every chunk is also written to an
 * IndexedDB crash backup (`lib/backup.ts`), removed once the recording is
 * saved; if saving fails, or the browser goes away mid-recording, the popup
 * offers the backup back.
 */

type Session = {
  recorder: MediaRecorder;
  chunks: Blob[];
  streams: MediaStream[];
  context: AudioContext;
  startedAt: number;
  origin: string;
  save: SaveOptions;
  ticker: ReturnType<typeof setInterval>;
  finishing: boolean;
  backup: RecordingBackup;
};

let session: Session | null = null;
const baseFetch = globalThis.fetch.bind(globalThis);
const backupStore = createIdbBackupStore();

function emit(event: RecorderEvent) {
  void chrome.runtime.sendMessage(event).catch(() => {});
}

function pickMimeType(): string {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function release(current: Session) {
  clearInterval(current.ticker);
  for (const stream of current.streams) for (const track of stream.getTracks()) track.stop();
  void current.context.close().catch(() => {});
}

async function start(command: Extract<OffscreenCommand, { type: "offscreen:start" }>): Promise<CommandResponse> {
  if (session) return { ok: false, error: "A recording is already in progress." };
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: command.streamId } } as MediaTrackConstraints,
    video: false,
  });
  const context = new AudioContext();
  const mix = context.createMediaStreamDestination();
  const tabSource = context.createMediaStreamSource(tabStream);
  tabSource.connect(mix);
  tabSource.connect(context.destination); // Keep the tab audible while it is captured.
  const streams = [tabStream];

  let micIncluded = false;
  if (command.withMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      context.createMediaStreamSource(micStream).connect(mix); // Recorded, never played back.
      streams.push(micStream);
      micIncluded = true;
    } catch {
      // No permission or no microphone: record the tab alone and say so in the popup.
    }
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(mix.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 96_000 });
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  const backup = new RecordingBackup(backupStore, {
    id: newBackupId(startedAt),
    title: command.save.title,
    language: command.save.language,
    origin: command.origin,
    ownerId: command.save.ownerId,
    mimeType: recordingMimeType(mimeType || "audio/webm"),
    startedAt,
    updatedAt: startedAt,
    durationSeconds: 0,
    chunks: 0,
    bytes: 0,
  });
  void backup.begin();
  // Tidy up backups nobody will recover (older than a week, or empty).
  void backupStore
    .list()
    .then(list => Promise.all(staleBackups(list, { activeId: backup.meta.id }).map(stale => backupStore.remove(stale.id))))
    .catch(() => {});
  recorder.ondataavailable = event => {
    if (event.data.size > 0) {
      chunks.push(event.data);
      void backup.append(event.data);
    }
  };
  const current: Session = {
    recorder,
    chunks,
    streams,
    context,
    startedAt,
    origin: command.origin,
    save: command.save,
    finishing: false,
    backup,
    ticker: setInterval(() => emit({ type: "recorder:tick", elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) }), 1000),
  };
  session = current;
  // Closing the tab ends its stream; save what was recorded rather than lose it.
  for (const track of tabStream.getAudioTracks()) track.addEventListener("ended", () => void finish(current));
  recorder.start(1000);
  return { ok: true, micIncluded };
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === "inactive") return Promise.resolve();
  return new Promise(resolve => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.stop();
  });
}

const multipart: MultipartUploader = async ({ key, body, contentType, handleUploadUrl, size, onProgress }) => {
  await uploadPresigned(key, body, {
    access: "private",
    handleUploadUrl,
    clientPayload: JSON.stringify({ size }),
    contentType,
    multipart: true,
    onUploadProgress: ({ percentage }) => onProgress(percentage / 100),
  });
};

/** Uploads audio and creates the recording; shared by a finished recording and a recovered backup. */
async function saveToStudyScribe(input: { blob: Blob; mimeType: "audio/webm" | "audio/mp4" | "audio/ogg"; durationSeconds: number; origin: string; save: SaveOptions }) {
  // The Blob SDK fetches its upload token without credentials; add them for the StudyScribe origin only.
  globalThis.fetch = withSiteCredentials(input.origin, baseFetch);
  const api = createApi(input.origin, baseFetch);
  const audio = await uploadRecordingAudio(
    input.blob,
    recordingFileName(input.mimeType),
    { api, put: (url, init) => baseFetch(url, init), multipart },
    percent => emit({ type: "recorder:progress", percent }),
  );
  return api.createRecording({
    title: input.save.title,
    duration: input.durationSeconds,
    language: input.save.language,
    audio,
  });
}

async function finish(current: Session) {
  if (current.finishing) return;
  current.finishing = true;
  try {
    await stopRecorder(current.recorder);
    release(current);
    const durationSeconds = Math.max(1, Math.round((Date.now() - current.startedAt) / 1000));
    const mimeType = recordingMimeType(current.recorder.mimeType || "audio/webm");
    const blob = assembleRecording(current.chunks, mimeType);
    const recording = await saveToStudyScribe({ blob, mimeType, durationSeconds, origin: current.origin, save: current.save });
    await current.backup.remove();
    emit({ type: "recorder:progress", percent: 100 });
    emit({ type: "recorder:saved", recording: { id: recording.id, title: recording.title } });
  } catch (error) {
    // Keep the backup (with every chunk written) so the popup can offer "Try again".
    await current.backup.flush();
    await current.backup.markFailed();
    const kept = current.backup.degraded ? "" : " A copy is kept in this browser, so you can try saving it again.";
    emit({ type: "recorder:failed", message: `${describeError(error, "The recording could not be saved.")}${kept}` });
  } finally {
    if (session === current) session = null;
  }
}

/** Uploads a crash backup. Answers once it is read; progress and the result arrive as recorder events. */
async function recover(id: string): Promise<CommandResponse> {
  if (session) return { ok: false, error: "Finish the current recording first." };
  const meta = await backupStore.get(id);
  if (!meta) return { ok: false, error: "That saved copy is no longer in this browser." };
  const chunks = await backupStore.readChunks(id);
  if (chunks.length === 0) {
    await backupStore.remove(id).catch(() => {});
    return { ok: false, error: "That saved copy has no audio in it." };
  }
  const mimeType = recordingMimeType(meta.mimeType);
  const blob = assembleRecording(chunks, mimeType);
  void (async () => {
    try {
      const recording = await saveToStudyScribe({
        blob,
        mimeType,
        durationSeconds: Math.max(1, meta.durationSeconds),
        origin: meta.origin,
        save: { title: meta.title, language: meta.language, ownerId: meta.ownerId },
      });
      await backupStore.remove(id).catch(() => {});
      emit({ type: "recorder:progress", percent: 100 });
      emit({ type: "recorder:saved", recording: { id: recording.id, title: recording.title } });
    } catch (error) {
      await backupStore.putMeta({ ...meta, failedAt: Date.now() }).catch(() => {});
      emit({ type: "recorder:failed", message: `${describeError(error, "The saved copy could not be uploaded.")} It is still kept in this browser.` });
    }
  })();
  return { ok: true };
}

function discard(): CommandResponse {
  const current = session;
  session = null;
  if (current) {
    current.finishing = true;
    current.recorder.ondataavailable = null;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    release(current);
    void current.backup.flush().then(() => current.backup.remove());
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (!isFromThisExtension(sender, chrome.runtime.id)) return false;
  const message = parseMessage(raw);
  if (!message || !message.type.startsWith("offscreen:")) return false;
  const command = message as OffscreenCommand;
  const run = async (): Promise<CommandResponse> => {
    switch (command.type) {
      case "offscreen:start":
        return start(command);
      case "offscreen:stop":
        if (!session) return { ok: false, error: "Nothing is recording." };
        void finish(session);
        return { ok: true };
      case "offscreen:discard":
        return discard();
      case "offscreen:recover":
        return recover(command.id);
    }
  };
  run().then(sendResponse, error => sendResponse({ ok: false, error: describeError(error, "Recording could not start.") }));
  return true;
});
