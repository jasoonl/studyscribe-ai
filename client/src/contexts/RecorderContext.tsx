import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  appendChunk,
  deleteSession,
  loadUnsavedRecording,
  saveSession,
} from "@/lib/recordingBackup";
import {
  elapsedSeconds as readElapsedSeconds,
  formatClockTime,
  idleClock,
  pauseClock,
  resumeClock,
  startClock,
  type RecordingClock,
} from "@/lib/recordingClock";

/**
 * One microphone recorder for the whole app, mounted above the router.
 *
 * Recording used to live inside the Record pages, so it ended as soon as the
 * page unmounted, its length came from a timer that background tabs throttle,
 * and all audio stayed in memory until Stop. Keeping it here means a recording
 * runs until the user presses Stop: switching tabs or windows, moving around
 * the app, a microphone dropping out, or the tab crashing does not end it.
 *
 * - Elapsed time is wall-clock based (`recordingClock.ts`).
 * - Audio is flushed every second and mirrored to IndexedDB
 *   (`recordingBackup.ts`); the record pages offer to restore it after a crash.
 * - The microphone feeds the recorder through a Web Audio node, so when the
 *   device disconnects (Bluetooth headset, USB mic) a new one can be plugged in
 *   without restarting the recorder. Without Web Audio it records the
 *   microphone directly and stops, keeping the audio, if the device is lost.
 */
export type RecorderStatus = "idle" | "recording" | "paused" | "stopped";

export type FinishedRecording = { blob: Blob; mimeType: string; durationSeconds: number };

type RecorderContextValue = {
  status: RecorderStatus;
  elapsedSeconds: number;
  /** The microphone dropped out; the recorder keeps running while it reconnects. */
  micReconnecting: boolean;
  /** The current audio was restored from a backup after a crash or reload. */
  recovered: boolean;
  /** Page the recording was started from, for the floating indicator. */
  returnPath: string | null;
  /** A page currently shows the full recorder (see `useShowsRecorder`). */
  recorderOnScreen: boolean;
  registerOnScreen: () => () => void;
  start: (options: { userId: number | null; returnPath: string }) => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  /** Drops the audio and its backup (after a successful upload, or on Discard). */
  discard: () => void;
  getRecording: () => FinishedRecording | null;
  /** Offers back the newest unsaved recording for this user, if any survived. */
  restoreUnsaved: (userId: number | null) => Promise<void>;
};

const RecorderContext = createContext<RecorderContextValue | null>(null);

const CHUNK_INTERVAL_MS = 1000;
const RECONNECT_RETRY_MS = 3000;
const LOCK_PREFIX = "studyscribe-recording-";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/wav")) return "audio/wav";
  return "";
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext ?? null;
}

async function liveSessionIdsInOtherTabs(): Promise<Set<string>> {
  try {
    if (typeof navigator === "undefined" || !navigator.locks) return new Set();
    const snapshot = await navigator.locks.query();
    return new Set(
      (snapshot.held ?? [])
        .map(lock => lock.name ?? "")
        .filter(name => name.startsWith(LOCK_PREFIX))
        .map(name => name.slice(LOCK_PREFIX.length)),
    );
  } catch {
    return new Set();
  }
}

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micReconnecting, setMicReconnecting] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [returnPath, setReturnPath] = useState<string | null>(null);
  const [onScreenCount, setOnScreenCount] = useState(0);

  const statusRef = useRef<RecorderStatus>("idle");
  const clockRef = useRef<RecordingClock>(idleClock);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);
  const sessionMetaRef = useRef<{ userId: number | null; startedAt: number } | null>(null);
  const seqRef = useRef(0);
  const userStopRef = useRef(false);
  const stopResolversRef = useRef<Array<() => void>>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingRef = useRef(false);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const restoringRef = useRef(false);
  const originalTitleRef = useRef<string | null>(null);

  const updateStatus = useCallback((next: RecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const isLive = () => statusRef.current === "recording" || statusRef.current === "paused";

  const refreshElapsed = useCallback(() => {
    setElapsedSeconds(readElapsedSeconds(clockRef.current, Date.now()));
  }, []);

  const holdLock = useCallback((sessionId: string) => {
    releaseLockRef.current?.();
    releaseLockRef.current = null;
    if (typeof navigator === "undefined" || !navigator.locks) return;
    navigator.locks
      .request(LOCK_PREFIX + sessionId, () => new Promise<void>(resolve => {
        releaseLockRef.current = resolve;
      }))
      .catch(() => {});
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    reconnectingRef.current = false;
    setMicReconnecting(false);
  }, []);

  const releaseMicrophone = useCallback(() => {
    micStreamRef.current?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    micStreamRef.current = null;
    try {
      micSourceRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    micSourceRef.current = null;
  }, []);

  const releaseAudioGraph = useCallback(() => {
    releaseMicrophone();
    destinationRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
  }, [releaseMicrophone]);

  // Declared before use through refs so the track/recorder callbacks always
  // reach the latest versions.
  const handleMicLostRef = useRef<() => void>(() => {});

  const attachMicrophone = useCallback((stream: MediaStream) => {
    micStreamRef.current = stream;
    const context = audioContextRef.current;
    const destination = destinationRef.current;
    if (context && destination) {
      const source = context.createMediaStreamSource(stream);
      source.connect(destination);
      micSourceRef.current = source;
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (micStreamRef.current === stream) handleMicLostRef.current();
        };
      });
    }
  }, []);

  const tryReconnect = useCallback(async () => {
    if (!isLive() || !reconnectingRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (!isLive() || !reconnectingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      attachMicrophone(stream);
      clearReconnect();
      toast.success("Microphone reconnected. Still recording.");
    } catch {
      if (isLive() && reconnectingRef.current) {
        reconnectTimerRef.current = setTimeout(() => void tryReconnect(), RECONNECT_RETRY_MS);
      }
    }
  }, [attachMicrophone, clearReconnect]);

  handleMicLostRef.current = () => {
    if (!isLive() || reconnectingRef.current) return;
    releaseMicrophone();
    reconnectingRef.current = true;
    setMicReconnecting(true);
    toast.warning("Microphone disconnected. Recording continues and will pick up as soon as a microphone is available.");
    void tryReconnect();
  };

  // A newly plugged-in microphone is picked up straight away.
  useEffect(() => {
    if (!micReconnecting || typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const onDeviceChange = () => void tryReconnect();
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, [micReconnecting, tryReconnect]);

  const finishStop = useCallback(() => {
    const wasUserStop = userStopRef.current;
    userStopRef.current = false;
    clockRef.current = pauseClock(clockRef.current, Date.now());
    recorderRef.current = null;
    clearReconnect();
    releaseAudioGraph();
    refreshElapsed();
    const sessionId = sessionIdRef.current;
    const meta = sessionMetaRef.current;
    if (sessionId && meta && chunksRef.current.length > 0) {
      void saveSession({
        id: sessionId,
        userId: meta.userId,
        mimeType: mimeTypeRef.current,
        startedAt: meta.startedAt,
        elapsedSeconds: readElapsedSeconds(clockRef.current, Date.now()),
        updatedAt: Date.now(),
      });
    }
    if (statusRef.current !== "idle") {
      updateStatus("stopped");
      if (!wasUserStop) {
        toast.error("The microphone stopped, so the recording ended. Everything recorded so far is kept: add a title and save it.");
      }
    }
    const resolvers = stopResolversRef.current;
    stopResolversRef.current = [];
    resolvers.forEach(resolve => resolve());
  }, [clearReconnect, refreshElapsed, releaseAudioGraph, updateStatus]);

  const start = useCallback<RecorderContextValue["start"]>(async ({ userId, returnPath: path }) => {
    if (statusRef.current === "recording" || statusRef.current === "paused") return true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("This browser can't record audio. Try the latest Chrome, Edge, Safari or Firefox.");
      return false;
    }

    // Create the audio graph inside the click handler, before any await, so
    // browsers that require a user gesture let it run.
    const AudioContextCtor = getAudioContextConstructor();
    let context: AudioContext | null = null;
    try {
      context = AudioContextCtor ? new AudioContextCtor() : null;
      void context?.resume().catch(() => {});
    } catch {
      context = null;
    }

    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      void context?.close().catch(() => {});
      toast.error("Unable to access the microphone. Please check permissions.");
      return false;
    }

    let recordStream: MediaStream = micStream;
    if (context) {
      try {
        if (context.state !== "running") await context.resume();
        if (context.state !== "running") throw new Error("Audio context did not start");
        audioContextRef.current = context;
        destinationRef.current = context.createMediaStreamDestination();
        attachMicrophone(micStream);
        recordStream = destinationRef.current.stream;
        // Safari can interrupt the context (another app takes audio); resume it.
        context.onstatechange = () => {
          if (isLive() && context && context.state !== "running" && context.state !== "closed") {
            void context.resume().catch(() => {});
          }
        };
      } catch {
        // Record the microphone directly rather than risk recording silence.
        releaseMicrophone();
        destinationRef.current = null;
        audioContextRef.current = null;
        void context.close().catch(() => {});
        micStreamRef.current = micStream;
        recordStream = micStream;
      }
    } else {
      micStreamRef.current = micStream;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseAudioGraph();
      toast.error("Recording isn't supported in this browser.");
      return false;
    }

    const sessionId = newSessionId();
    const startedAt = Date.now();
    sessionIdRef.current = sessionId;
    sessionMetaRef.current = { userId, startedAt };
    seqRef.current = 0;
    chunksRef.current = [];
    mimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";
    userStopRef.current = false;
    recorderRef.current = recorder;

    recorder.ondataavailable = event => {
      if (event.data.size === 0 || recorderRef.current !== recorder) return;
      chunksRef.current.push(event.data);
      const seq = seqRef.current++;
      void appendChunk(sessionId, seq, event.data, readElapsedSeconds(clockRef.current, Date.now()));
    };
    recorder.onstop = () => {
      if (recorderRef.current === recorder) finishStop();
    };
    recorder.onerror = () => {
      toast.error("The recorder hit an error. Everything recorded so far is kept.");
    };

    await saveSession({
      id: sessionId,
      userId,
      mimeType: mimeTypeRef.current,
      startedAt,
      elapsedSeconds: 0,
      updatedAt: startedAt,
    });
    holdLock(sessionId);

    recorder.start(CHUNK_INTERVAL_MS);
    clockRef.current = startClock(Date.now());
    setRecovered(false);
    setReturnPath(path);
    setElapsedSeconds(0);
    updateStatus("recording");
    return true;
  }, [attachMicrophone, finishStop, holdLock, releaseAudioGraph, releaseMicrophone, updateStatus]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (statusRef.current !== "recording" || !recorder) return;
    try {
      recorder.pause();
    } catch {
      return;
    }
    clockRef.current = pauseClock(clockRef.current, Date.now());
    refreshElapsed();
    updateStatus("paused");
  }, [refreshElapsed, updateStatus]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (statusRef.current !== "paused" || !recorder) return;
    try {
      recorder.resume();
    } catch {
      return;
    }
    clockRef.current = resumeClock(clockRef.current, Date.now());
    refreshElapsed();
    updateStatus("recording");
  }, [refreshElapsed, updateStatus]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    return new Promise<void>(resolve => {
      stopResolversRef.current.push(resolve);
      userStopRef.current = true;
      recorder.stop();
    });
  }, []);

  const discard = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    clearReconnect();
    releaseAudioGraph();
    const sessionId = sessionIdRef.current;
    if (sessionId) void deleteSession(sessionId);
    releaseLockRef.current?.();
    releaseLockRef.current = null;
    sessionIdRef.current = null;
    sessionMetaRef.current = null;
    chunksRef.current = [];
    clockRef.current = idleClock;
    setElapsedSeconds(0);
    setRecovered(false);
    setReturnPath(null);
    updateStatus("idle");
    const resolvers = stopResolversRef.current;
    stopResolversRef.current = [];
    resolvers.forEach(resolve => resolve());
  }, [clearReconnect, releaseAudioGraph, updateStatus]);

  const getRecording = useCallback((): FinishedRecording | null => {
    if (chunksRef.current.length === 0) return null;
    const mimeType = mimeTypeRef.current || "audio/webm";
    return {
      blob: new Blob(chunksRef.current, { type: mimeType }),
      mimeType,
      durationSeconds: readElapsedSeconds(clockRef.current, Date.now()),
    };
  }, []);

  const restoreUnsaved = useCallback(async (userId: number | null) => {
    if (statusRef.current !== "idle" || restoringRef.current) return;
    restoringRef.current = true;
    try {
      const liveElsewhere = await liveSessionIdsInOtherTabs();
      const backup = await loadUnsavedRecording(userId, liveElsewhere);
      if (!backup || statusRef.current !== "idle") return;
      sessionIdRef.current = backup.id;
      sessionMetaRef.current = { userId: backup.userId, startedAt: backup.startedAt };
      chunksRef.current = [backup.blob];
      mimeTypeRef.current = backup.mimeType;
      clockRef.current = { runningSince: null, accumulatedMs: backup.elapsedSeconds * 1000 };
      holdLock(backup.id);
      setElapsedSeconds(backup.elapsedSeconds);
      setRecovered(true);
      updateStatus("stopped");
      toast.info(`Recovered an unsaved recording (${formatClockTime(backup.elapsedSeconds)}). Add a title to save it, or discard it.`);
    } finally {
      restoringRef.current = false;
    }
  }, [holdLock, updateStatus]);

  // Re-render the clock. Background tabs throttle this, but the value comes
  // from timestamps, so it is exact whenever it does run.
  useEffect(() => {
    if (status !== "recording" && status !== "paused") return;
    refreshElapsed();
    const interval = setInterval(refreshElapsed, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshElapsed();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, refreshElapsed]);

  // Show the recording state in the tab title so it is visible from other tabs.
  useEffect(() => {
    if (status === "recording" || status === "paused") {
      if (originalTitleRef.current === null) originalTitleRef.current = document.title;
      const label = status === "paused" ? "Paused" : "● Recording";
      document.title = `${label} ${formatClockTime(elapsedSeconds)} · StudyScribe`;
    } else if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
      originalTitleRef.current = null;
    }
  }, [status, elapsedSeconds]);

  // Warn before closing or reloading the tab while audio would be lost.
  useEffect(() => {
    if (status === "idle") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  const registerOnScreen = useCallback(() => {
    setOnScreenCount(count => count + 1);
    return () => setOnScreenCount(count => count - 1);
  }, []);

  const value = useMemo<RecorderContextValue>(() => ({
    status,
    elapsedSeconds,
    micReconnecting,
    recovered,
    returnPath,
    recorderOnScreen: onScreenCount > 0,
    registerOnScreen,
    start,
    pause,
    resume,
    stop,
    discard,
    getRecording,
    restoreUnsaved,
  }), [status, elapsedSeconds, micReconnecting, recovered, returnPath, onScreenCount, registerOnScreen, start, pause, resume, stop, discard, getRecording, restoreUnsaved]);

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

export function useRecorder(): RecorderContextValue {
  const context = useContext(RecorderContext);
  if (!context) throw new Error("useRecorder must be used inside RecorderProvider");
  return context;
}

/** Marks the full recorder as visible, which hides the floating indicator. */
export function useShowsRecorder(active: boolean) {
  const { registerOnScreen } = useRecorder();
  useEffect(() => (active ? registerOnScreen() : undefined), [active, registerOnScreen]);
}
