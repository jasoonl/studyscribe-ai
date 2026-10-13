import { uploadPresigned } from "@vercel/blob/client";
import { createApi } from "./lib/api";
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
 * records, like the web app's recorder.
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
};

let session: Session | null = null;
const baseFetch = globalThis.fetch.bind(globalThis);

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
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const startedAt = Date.now();
  const current: Session = {
    recorder,
    chunks,
    streams,
    context,
    startedAt,
    origin: command.origin,
    save: command.save,
    finishing: false,
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

async function finish(current: Session) {
  if (current.finishing) return;
  current.finishing = true;
  try {
    await stopRecorder(current.recorder);
    release(current);
    const durationSeconds = Math.max(1, Math.round((Date.now() - current.startedAt) / 1000));
    const mimeType = recordingMimeType(current.recorder.mimeType || "audio/webm");
    const blob = assembleRecording(current.chunks, mimeType);
    // The Blob SDK fetches its upload token without credentials; add them for the StudyScribe origin only.
    globalThis.fetch = withSiteCredentials(current.origin, baseFetch);
    const api = createApi(current.origin, baseFetch);
    const audio = await uploadRecordingAudio(
      blob,
      recordingFileName(mimeType),
      { api, put: (url, init) => baseFetch(url, init), multipart },
      percent => emit({ type: "recorder:progress", percent }),
    );
    const recording = await api.createRecording({
      title: current.save.title,
      duration: durationSeconds,
      language: current.save.language,
      audio,
    });
    emit({ type: "recorder:progress", percent: 100 });
    emit({ type: "recorder:saved", recording: { id: recording.id, title: recording.title } });
  } catch (error) {
    emit({ type: "recorder:failed", message: describeError(error, "The recording could not be saved.") });
  } finally {
    if (session === current) session = null;
  }
}

function discard(): CommandResponse {
  const current = session;
  session = null;
  if (current) {
    current.finishing = true;
    current.recorder.ondataavailable = null;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    release(current);
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
    }
  };
  run().then(sendResponse, error => sendResponse({ ok: false, error: describeError(error, "Recording could not start.") }));
  return true;
});
