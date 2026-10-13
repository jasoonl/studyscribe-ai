import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import * as Crypto from "expo-crypto";
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { API_URL } from "../config";
import { fileSource, nativeUploadIo } from "../fileSource";
import { useSession } from "../SessionProvider";
import { trpc } from "../trpc";
import { uploadAudio } from "../upload";
import { deleteRecordingFile, ensureRecordingsDir, fileExists, keepRecording, readJournal, writeJournal } from "./journal";
import { elapsedSeconds, initialRecorderState, isLive, recorderReducer, recoverFromJournal, type RecorderState } from "./machine";

/**
 * One recorder for the whole app, mounted above the navigator, so a lecture
 * keeps recording whatever screen the person opens (as on the web,
 * client/src/contexts/RecorderContext.tsx).
 *
 * Audio: AAC in an ADTS stream (.aac). Every ADTS frame carries its own
 * header, so the file on disk is playable up to the last second written even
 * if the app is killed mid-lecture; the crash journal (./journal.ts) then
 * offers it back on the next launch. Background recording is on: iOS keeps
 * the audio session alive with the screen locked (UIBackgroundModes audio),
 * Android runs a microphone foreground service with an ongoing notification
 * (both configured by the expo-audio plugin in app.config.ts).
 */
export const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".aac",
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  directory: "document",
  android: { extension: ".aac", outputFormat: "aac_adts", audioEncoder: "aac" },
  ios: { extension: ".aac", outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: { mimeType: "audio/webm", bitsPerSecond: 64000 },
};

export type SubmitOptions = {
  title: string;
  audience: "student" | "professional";
  language?: string;
  keyterms?: string[];
  courseId?: number | null;
};

type RecorderContextValue = {
  state: RecorderState;
  /** 0..1 input level while recording, for the meter. */
  level: number;
  start(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  mark(): void;
  stop(): Promise<void>;
  submit(options: SubmitOptions): Promise<number | null>;
  discard(): Promise<void>;
  elapsed(now?: number): number;
};

const RecorderContext = createContext<RecorderContextValue | null>(null);

export class MicrophonePermissionError extends Error {}

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(recorderReducer, initialRecorderState);
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const status = useAudioRecorderState(recorder, 500);
  const utils = trpc.useUtils();
  const { controller } = useSession();
  const stateRef = useRef(state);
  stateRef.current = state;

  // Offer back a session the app lost (crash, force quit, phone restart).
  useEffect(() => {
    const recovered = recoverFromJournal(readJournal(), fileExists);
    if (recovered) dispatch({ type: "RESTORE", state: recovered });
    else writeJournal(initialRecorderState);
  }, []);

  // Journal every transition, and every few seconds while recording.
  useEffect(() => {
    writeJournal(state);
    if (state.phase !== "recording") return;
    const timer = setInterval(() => writeJournal(stateRef.current), 5000);
    return () => clearInterval(timer);
  }, [state]);

  // Save the journal when the app goes to the background, in case the system ends it there.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") writeJournal(stateRef.current);
    });
    return () => subscription.remove();
  }, []);

  // The file path is known once the native recorder has prepared.
  useEffect(() => {
    if (status.url && isLive(state)) dispatch({ type: "FILE", uri: status.url });
  }, [status.url, state]);

  // A phone call or another app taking the microphone stops the native recorder; show it as paused.
  const quietSince = useRef<number | null>(null);
  useEffect(() => {
    if (state.phase !== "recording" || status.isRecording) {
      quietSince.current = null;
      return;
    }
    const now = Date.now();
    if (now - state.runningSince < 2500) return;
    quietSince.current ??= now;
    if (now - quietSince.current > 1500) dispatch({ type: "PAUSE", now, reason: "interrupted" });
  }, [state, status.isRecording, status.durationMillis]);

  const start = useCallback(async () => {
    if (stateRef.current.phase !== "idle") return;
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) throw new MicrophonePermissionError("StudyScribe needs microphone access to record. You can allow it in Settings.");
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      allowsBackgroundRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });
    ensureRecordingsDir();
    await recorder.prepareToRecordAsync();
    recorder.record();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    dispatch({ type: "START", now: Date.now(), sessionId: Crypto.randomUUID(), fileUri: recorder.uri });
  }, [recorder]);

  const pause = useCallback(() => {
    if (stateRef.current.phase !== "recording") return;
    recorder.pause();
    dispatch({ type: "PAUSE", now: Date.now(), reason: "user" });
  }, [recorder]);

  const resume = useCallback(async () => {
    if (stateRef.current.phase !== "paused") return;
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true, allowsBackgroundRecording: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" });
    recorder.record();
    dispatch({ type: "RESUME", now: Date.now() });
  }, [recorder]);

  const mark = useCallback(() => {
    if (!isLive(stateRef.current)) return;
    Haptics.selectionAsync().catch(() => undefined);
    dispatch({ type: "MARK", now: Date.now() });
  }, []);

  const stop = useCallback(async () => {
    const current = stateRef.current;
    if (!isLive(current)) return;
    await recorder.stop();
    const uri = recorder.uri ?? current.fileUri;
    if (!uri) throw new Error("The recording could not be saved.");
    const kept = keepRecording(uri, current.sessionId);
    dispatch({ type: "STOP", now: Date.now(), uri: kept });
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => undefined);
  }, [recorder]);

  const submit = useCallback(
    async (options: SubmitOptions) => {
      const current = stateRef.current;
      if (current.phase !== "stopped" && current.phase !== "failed") return null;
      dispatch({ type: "UPLOAD_START" });
      try {
        const name = Platform.OS === "web" ? "recording.webm" : "recording.aac";
        const source = fileSource(current.uri, name, Platform.OS === "web" ? "audio/webm" : "audio/aac");
        if (Platform.OS === "web" && !source.size) {
          const blob = await (await fetch(current.uri)).blob();
          (source as { size: number }).size = blob.size;
        }
        const uploaded = await uploadAudio(source, nativeUploadIo(API_URL, controller.getToken(), source), (progress) =>
          dispatch({ type: "UPLOAD_PROGRESS", progress: progress * 0.9 }),
        );
        const duration = elapsedSeconds(current, Date.now());
        const created = await utils.client.recordings.create.mutate({
          title: options.title,
          audience: options.audience,
          duration: duration > 0 ? duration : undefined,
          language: options.language as never,
          keyterms: options.keyterms?.length ? options.keyterms : undefined,
          bookmarks: current.bookmarks.length ? current.bookmarks.map((bookmark) => ({ atSeconds: bookmark.atSeconds })) : undefined,
          ...(uploaded.kind === "stored" ? { audioUpload: { key: uploaded.key, mimeType: uploaded.mimeType } } : { audioBase64: uploaded.base64 }),
        } as never);
        const recordingId = Number((created as { id?: number; recordingId?: number }).id ?? (created as { recordingId?: number }).recordingId);
        if (options.courseId && recordingId) {
          await utils.client.recordings.setCourse.mutate({ recordingId, courseId: options.courseId }).catch(() => undefined);
        }
        dispatch({ type: "SUBMITTED", recordingId });
        deleteRecordingFile(current.uri);
        utils.recordings.list.invalidate().catch(() => undefined);
        return recordingId;
      } catch (error) {
        dispatch({ type: "FAILED", error: error instanceof Error ? error.message : "The upload failed." });
        return null;
      }
    },
    [controller, utils],
  );

  const discard = useCallback(async () => {
    const current = stateRef.current;
    if (isLive(current)) await recorder.stop().catch(() => undefined);
    if (current.phase !== "idle") {
      const uri = "uri" in current ? current.uri : current.fileUri;
      if (uri && current.phase !== "submitted") deleteRecordingFile(uri);
    }
    dispatch({ type: "RESET" });
  }, [recorder]);

  const level = useMemo(() => {
    // Metering is in dBFS (about -60 silence to 0 loud); map to 0..1.
    if (state.phase !== "recording" || typeof status.metering !== "number") return 0;
    return Math.max(0, Math.min(1, (status.metering + 60) / 60));
  }, [state.phase, status.metering]);

  const value = useMemo<RecorderContextValue>(
    () => ({ state, level, start, pause, resume, mark, stop, submit, discard, elapsed: (now = Date.now()) => elapsedSeconds(state, now) }),
    [state, level, start, pause, resume, mark, stop, submit, discard],
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

export function useRecorder() {
  const context = useContext(RecorderContext);
  if (!context) throw new Error("useRecorder must be used inside RecorderProvider");
  return context;
}
