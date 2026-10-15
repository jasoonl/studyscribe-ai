import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TRPCClientError } from "@trpc/client";
import workletUrl from "@/lib/liveAudioWorklet.ts?worker&url";
// Type only: the transcriber loads the first time live text starts, so it stays out of the app shell.
import type { LiveStatus, LiveTranscriber } from "@/lib/liveTranscription";
import type { LiveTurn } from "@/lib/liveTurns";
import { getLiveTranscriptEnabled, setLiveTranscriptEnabled } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";
import { t } from "@/i18n";
import { useRecorder, type AudioTap } from "./RecorderContext";
import type { LiveAssistAction } from "@shared/liveAssist";

/**
 * Live text while recording (A1), app-wide like the recorder it listens to, so
 * it keeps going when the person moves around the app or switches tabs.
 *
 * It follows the recorder: starts when recording starts (if switched on),
 * closes the session while paused, and stops on Stop. The text stays until
 * the recorder is cleared; the record pages keep their own copy while the
 * real transcript is being made, then drop it.
 */
type LiveTranscriptValue = {
  /** Per-browser opt-in; off by default because streaming is billed per minute. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  status: LiveStatus | "unsupported";
  message: string | null;
  turns: LiveTurn[];
  /** Study help answers for this recording, newest first. */
  assists: LiveAssistEntry[];
  addAssist: (entry: LiveAssistEntry) => void;
};

export type LiveAssistEntry = { id: string; action: LiveAssistAction; question: string | null; answer: string; atSeconds: number };

const LiveTranscriptContext = createContext<LiveTranscriptValue | null>(null);

const workletLoaded = new WeakSet<BaseAudioContext>();

async function createTapNode(tap: AudioTap): Promise<AudioWorkletNode> {
  if (!workletLoaded.has(tap.context)) {
    await tap.context.audioWorklet.addModule(workletUrl);
    workletLoaded.add(tap.context);
  }
  // No outputs: it only listens, so nothing can leak into the recording.
  return new AudioWorkletNode(tap.context, "studyscribe-pcm16", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
}

export function LiveTranscriptProvider({ children }: { children: ReactNode }) {
  const recorder = useRecorder();
  const { status: recorderStatus, audioTap, getElapsedSeconds } = recorder;
  const [enabled, setEnabledState] = useState(getLiveTranscriptEnabled);
  const [status, setStatus] = useState<LiveTranscriptValue["status"]>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [assists, setAssists] = useState<LiveAssistEntry[]>([]);
  const liveToken = trpc.recordings.liveToken.useMutation();
  const mintToken = useRef(liveToken.mutateAsync);
  mintToken.current = liveToken.mutateAsync;
  const elapsedRef = useRef(getElapsedSeconds);
  elapsedRef.current = getElapsedSeconds;

  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const ensureTranscriber = useCallback(async () => {
    if (transcriberRef.current) return transcriberRef.current;
    const { LiveTranscriber: Transcriber, LiveUnavailableError } = await import("@/lib/liveTranscription");
    transcriberRef.current ??= new Transcriber({
      getToken: async () => {
        try {
          return await mintToken.current();
        } catch (error) {
          if (error instanceof TRPCClientError && error.data?.code === "PRECONDITION_FAILED") {
            throw new LiveUnavailableError(error.message);
          }
          throw error;
        }
      },
      getElapsedSeconds: () => elapsedRef.current(),
      onTurns: update => setTurns(update),
      onStatus: (next, detail) => {
        setStatus(next);
        setMessage(detail);
      },
    });
    return transcriberRef.current;
  }, []);

  const nodeRef = useRef<{ tap: AudioTap; node: AudioWorkletNode } | null>(null);
  const attachingRef = useRef<Promise<void> | null>(null);

  const detachNode = useCallback(() => {
    const current = nodeRef.current;
    nodeRef.current = null;
    if (!current) return;
    current.node.port.onmessage = null;
    try {
      current.tap.node.disconnect(current.node);
    } catch {
      // Already disconnected.
    }
  }, []);

  const attachNode = useCallback(async (tap: AudioTap) => {
    if (nodeRef.current?.tap === tap) return;
    detachNode();
    const node = await createTapNode(tap);
    node.port.onmessage = event => {
      if (event.data instanceof ArrayBuffer) transcriberRef.current?.pushAudio(event.data);
    };
    tap.node.connect(node);
    nodeRef.current = { tap, node };
  }, [detachNode]);

  // A new recording starts with a clean slate; a cleared recorder drops the text.
  const previousStatus = useRef(recorderStatus);
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = recorderStatus;
    if (recorderStatus === "idle" || (recorderStatus === "recording" && (before === "idle" || before === "stopped"))) {
      setTurns([]);
      setAssists([]);
      setMessage(null);
    }
  }, [recorderStatus]);

  useEffect(() => {
    let cancelled = false;
    const live = recorderStatus === "recording" || recorderStatus === "paused";
    if (!enabled || !live) {
      detachNode();
      const current = transcriberRef.current;
      if (current && current.currentStatus !== "idle") void current.stop();
      else setStatus("idle");
      return;
    }
    if (!audioTap || typeof AudioWorkletNode === "undefined" || !audioTap.context.audioWorklet) {
      setStatus("unsupported");
      setMessage(t("record.live.unsupported"));
      return;
    }
    if (recorderStatus === "paused") {
      transcriberRef.current?.pause();
      return;
    }
    const attaching = attachNode(audioTap);
    attachingRef.current = attaching;
    attaching
      .then(() => ensureTranscriber())
      .then(transcriber => {
        if (!cancelled) transcriber.start();
      })
      .catch(error => {
        console.warn("[live] could not start the audio tap:", error);
        if (!cancelled) {
          setStatus("unsupported");
          setMessage(t("record.live.couldNotStart"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, recorderStatus, audioTap, attachNode, detachNode, ensureTranscriber]);

  // Back online: reconnect now instead of waiting out the backoff.
  useEffect(() => {
    const onOnline = () => transcriberRef.current?.retryNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => () => {
    void transcriberRef.current?.stop();
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setLiveTranscriptEnabled(next);
    setEnabledState(next);
  }, []);

  const addAssist = useCallback((entry: LiveAssistEntry) => setAssists(current => [entry, ...current].slice(0, 30)), []);

  const value = useMemo<LiveTranscriptValue>(
    () => ({ enabled, setEnabled, status, message, turns, assists, addAssist }),
    [enabled, setEnabled, status, message, turns, assists, addAssist],
  );
  return <LiveTranscriptContext.Provider value={value}>{children}</LiveTranscriptContext.Provider>;
}

export function useLiveTranscript(): LiveTranscriptValue {
  const context = useContext(LiveTranscriptContext);
  if (!context) throw new Error("useLiveTranscript must be used inside LiveTranscriptProvider");
  return context;
}
