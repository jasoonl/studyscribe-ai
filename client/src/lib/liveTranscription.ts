/**
 * Live transcription while recording (A1).
 *
 * The browser streams 16 kHz PCM16 straight to AssemblyAI's Universal-Streaming
 * WebSocket (v3) with a temporary token from `recordings.liveToken`, so no
 * server function holds a socket open and the API key never reaches the page.
 * Audio comes from an AudioWorklet tapped off the recorder's own Web Audio
 * graph (`RecorderProvider`): no second microphone stream, and the
 * MediaRecorder never sees this code.
 *
 * Everything here is best effort. If the token, the socket or the service
 * fails, live text pauses or stops with a message and the recording carries on
 * untouched; the finished file still goes through the batch pipeline for the
 * authoritative transcript.
 *
 * Sessions:
 * - Audio that arrives before the service says `Begin` is queued (up to 15s),
 *   so nothing is lost while the token and socket are set up.
 * - Pausing the recording terminates the session (streaming is billed while the
 *   socket is open) and resuming opens a new one.
 * - Sessions are capped (`maxSessionSeconds`); shortly before the cap a second
 *   session is opened and audio switches over once it has begun, then the old
 *   one is terminated, so a long lecture has no gap.
 * - An unexpected close reconnects with backoff, giving up after a few
 *   consecutive failures.
 */
import { applyTurnMessage, settleSession, type LiveTurn, type StreamingTurnMessage } from "./liveTurns";

export type LiveStatus = "idle" | "connecting" | "live" | "reconnecting" | "paused" | "error" | "unavailable";

export type LiveGrant = { token: string; socketUrl: string; maxSessionSeconds: number };

/** Thrown by `getToken` when the server can't offer live text at all (no key, switched off). */
export class LiveUnavailableError extends Error {}

export type SocketLike = {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type LiveTranscriberDeps = {
  getToken: () => Promise<LiveGrant>;
  /** Seconds into the recording right now (the recorder's clock). */
  getElapsedSeconds: () => number;
  onTurns: (update: (turns: LiveTurn[]) => LiveTurn[]) => void;
  onStatus: (status: LiveStatus, message: string | null) => void;
  createSocket?: (url: string) => SocketLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const OPEN = 1;
const CONNECTING = 0;
/** 15s of 100ms chunks. */
const MAX_QUEUED_CHUNKS = 150;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const ROLLOVER_MARGIN_SECONDS = 90;
const TERMINATE_WAIT_MS = 5_000;

type Session = {
  index: number;
  offsetSeconds: number;
  socket: SocketLike | null;
  began: boolean;
  queue: ArrayBuffer[];
  terminating: boolean;
  closed: boolean;
  rollover: boolean;
  maxSessionSeconds: number;
  errorMessage: string | null;
  closeWaiters: Array<() => void>;
};

/** Words for a close the person can act on, or null to just retry. */
export function describeClose(code: number, providerMessage: string | null): { retry: boolean; message: string | null } {
  if (code === 1008 || code === 4001 || code === 4003) {
    return { retry: false, message: "The live transcription service refused the connection. Recording continues." };
  }
  if (code === 3009) {
    return { retry: true, message: "Too many live sessions are open right now. Retrying." };
  }
  if (code === 3007) {
    return { retry: true, message: providerMessage ? `Live audio was rejected (${providerMessage}). Retrying.` : null };
  }
  return { retry: true, message: null };
}

export class LiveTranscriber {
  private deps: Required<Pick<LiveTranscriberDeps, "setTimer" | "clearTimer" | "createSocket">> & LiveTranscriberDeps;
  private active: Session | null = null;
  private pending: Session | null = null;
  private wanted: "running" | "paused" | "stopped" = "stopped";
  private sessionCounter = 0;
  private failures = 0;
  private retryTimer: unknown = null;
  private rolloverTimer: unknown = null;
  private status: LiveStatus = "idle";

  constructor(deps: LiveTranscriberDeps) {
    this.deps = {
      createSocket: url => new WebSocket(url) as unknown as SocketLike,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...deps,
    };
  }

  get currentStatus() {
    return this.status;
  }

  /** Feed one chunk of 16 kHz PCM16 audio. */
  pushAudio(chunk: ArrayBuffer) {
    if (this.wanted !== "running") return;
    const session = this.active;
    if (!session || session.terminating) return;
    if (session.began && session.socket?.readyState === OPEN) {
      try {
        session.socket.send(chunk);
      } catch {
        // The close handler deals with a dead socket.
      }
      return;
    }
    session.queue.push(chunk);
    if (session.queue.length > MAX_QUEUED_CHUNKS) {
      // Dropping the oldest chunk moves the start of this session's audio.
      const dropped = session.queue.shift();
      session.offsetSeconds += (dropped?.byteLength ?? 0) / 2 / 16_000;
    }
  }

  start() {
    if (this.wanted === "running" && (this.active || this.retryTimer)) return;
    this.wanted = "running";
    this.failures = 0;
    if (!this.active) void this.open(false);
  }

  /** Recording paused: end the session so it isn't billed, keep the text. */
  pause() {
    if (this.wanted !== "running") return;
    this.wanted = "paused";
    this.clearTimers();
    void this.terminate(this.pending);
    void this.terminate(this.active);
    this.setStatus("paused", null);
  }

  resume() {
    this.start();
  }

  /** Recording stopped or live text switched off. Waits briefly for the last words. */
  async stop() {
    this.wanted = "stopped";
    this.clearTimers();
    const sessions = [this.pending, this.active];
    await Promise.all(sessions.map(session => this.terminate(session)));
    this.setStatus("idle", null);
  }

  /** Try now instead of waiting out the backoff (for example when the network comes back). */
  retryNow() {
    if (this.wanted !== "running" || this.active || !this.retryTimer) return;
    this.deps.clearTimer(this.retryTimer);
    this.retryTimer = null;
    void this.open(false);
  }

  private setStatus(status: LiveStatus, message: string | null) {
    this.status = status;
    this.deps.onStatus(status, message);
  }

  private clearTimers() {
    if (this.retryTimer) this.deps.clearTimer(this.retryTimer);
    if (this.rolloverTimer) this.deps.clearTimer(this.rolloverTimer);
    this.retryTimer = null;
    this.rolloverTimer = null;
  }

  private async open(rollover: boolean) {
    const session: Session = {
      index: this.sessionCounter++,
      offsetSeconds: this.deps.getElapsedSeconds(),
      socket: null,
      began: false,
      queue: [],
      terminating: false,
      closed: false,
      rollover,
      maxSessionSeconds: 3600,
      errorMessage: null,
      closeWaiters: [],
    };
    if (rollover) {
      this.pending = session;
    } else {
      this.active = session;
      this.setStatus(this.failures > 0 ? "reconnecting" : "connecting", null);
    }

    let grant: LiveGrant;
    try {
      grant = await this.deps.getToken();
    } catch (error) {
      this.detach(session);
      if (session.terminating || this.wanted !== "running") return;
      if (error instanceof LiveUnavailableError) {
        this.wanted = "stopped";
        this.setStatus("unavailable", error.message);
        return;
      }
      if (rollover) {
        // The current session still has time; try the handover again shortly.
        this.rolloverTimer = this.deps.setTimer(() => this.beginRollover(), 30_000);
        return;
      }
      this.scheduleRetry(error instanceof Error && error.message ? error.message : null);
      return;
    }
    if (session.terminating || this.wanted !== "running") {
      this.detach(session);
      return;
    }

    session.maxSessionSeconds = grant.maxSessionSeconds;
    const separator = grant.socketUrl.includes("?") ? "&" : "?";
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(`${grant.socketUrl}${separator}token=${encodeURIComponent(grant.token)}`);
    } catch {
      this.detach(session);
      if (!rollover) this.scheduleRetry(null);
      return;
    }
    socket.binaryType = "arraybuffer";
    session.socket = socket;
    socket.onmessage = event => this.handleMessage(session, event.data);
    socket.onclose = event => this.handleClose(session, event.code, event.reason);
    socket.onerror = () => {
      // Always followed by close.
    };
  }

  private detach(session: Session) {
    session.closed = true;
    if (this.active === session) this.active = null;
    if (this.pending === session) this.pending = null;
    session.closeWaiters.splice(0).forEach(resolve => resolve());
  }

  private handleMessage(session: Session, data: unknown) {
    if (typeof data !== "string") return;
    let message: { type?: string; [key: string]: unknown };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message.type) {
      case "Begin":
        this.handleBegin(session);
        break;
      case "Turn":
        this.deps.onTurns(turns =>
          applyTurnMessage(turns, message as unknown as StreamingTurnMessage, { index: session.index, offsetSeconds: session.offsetSeconds }, this.deps.getElapsedSeconds()),
        );
        break;
      case "Termination":
        this.deps.onTurns(turns => settleSession(turns, session.index));
        try {
          session.socket?.close(1000, "done");
        } catch {
          // Already closing.
        }
        break;
      case "Error":
        session.errorMessage = typeof message.error === "string" ? message.error : null;
        break;
    }
  }

  private handleBegin(session: Session) {
    session.began = true;
    if (session.terminating) return;
    if (session.rollover && this.pending === session) {
      // Hand over: new audio goes to the new session from now on.
      const previous = this.active;
      session.offsetSeconds = this.deps.getElapsedSeconds();
      session.rollover = false;
      this.pending = null;
      this.active = session;
      void this.terminate(previous);
    } else if (this.active === session) {
      const queued = session.queue.splice(0);
      for (const chunk of queued) {
        try {
          session.socket?.send(chunk);
        } catch {
          break;
        }
      }
    }
    this.failures = 0;
    this.setStatus("live", null);
    if (this.rolloverTimer) this.deps.clearTimer(this.rolloverTimer);
    const delaySeconds = Math.max(30, session.maxSessionSeconds - ROLLOVER_MARGIN_SECONDS);
    this.rolloverTimer = this.deps.setTimer(() => this.beginRollover(), delaySeconds * 1000);
  }

  private beginRollover() {
    this.rolloverTimer = null;
    if (this.wanted !== "running" || this.pending || !this.active?.began) return;
    void this.open(true);
  }

  private handleClose(session: Session, code: number, reason: string) {
    const wasActive = this.active === session;
    const wasPending = this.pending === session;
    this.deps.onTurns(turns => settleSession(turns, session.index));
    this.detach(session);
    if (session.terminating || this.wanted !== "running") return;

    if (wasPending) {
      // The handover failed; the current session keeps going until its cap, then reconnects.
      this.rolloverTimer = this.deps.setTimer(() => this.beginRollover(), 30_000);
      return;
    }
    if (!wasActive) return;
    if (this.rolloverTimer) this.deps.clearTimer(this.rolloverTimer);
    this.rolloverTimer = null;

    // Session cap reached without a handover: start a new one straight away.
    if (code === 3008) {
      void this.open(false);
      return;
    }
    const outcome = describeClose(code, session.errorMessage ?? (reason || null));
    if (!outcome.retry) {
      this.wanted = "stopped";
      this.setStatus("error", outcome.message);
      return;
    }
    this.scheduleRetry(outcome.message);
  }

  private scheduleRetry(message: string | null) {
    this.failures += 1;
    if (this.failures > RETRY_DELAYS_MS.length) {
      this.wanted = "stopped";
      this.setStatus("error", "Live text stopped after several failed attempts. Recording continues.");
      return;
    }
    this.setStatus("reconnecting", message);
    const delay = RETRY_DELAYS_MS[this.failures - 1];
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      if (this.wanted === "running" && !this.active) void this.open(false);
    }, delay);
  }

  private terminate(session: Session | null): Promise<void> {
    if (!session || session.closed) return Promise.resolve();
    session.terminating = true;
    // Free the slot now so a resume can open a fresh session straight away.
    if (this.active === session) this.active = null;
    if (this.pending === session) this.pending = null;
    session.queue = [];
    const socket = session.socket;
    if (!socket) {
      // Still waiting for a token; `open` drops it when the token arrives.
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      session.closeWaiters.push(resolve);
      try {
        if (socket.readyState === OPEN && session.began) {
          // The service flushes the last turn, sends Termination, then closes.
          socket.send(JSON.stringify({ type: "Terminate" }));
          const timer = this.deps.setTimer(() => {
            try {
              socket.close(1000, "done");
            } catch {
              // Already closed.
            }
            this.detach(session);
          }, TERMINATE_WAIT_MS);
          session.closeWaiters.push(() => this.deps.clearTimer(timer));
        } else if (socket.readyState === OPEN || socket.readyState === CONNECTING) {
          socket.close(1000, "done");
        } else {
          this.detach(session);
        }
      } catch {
        this.detach(session);
      }
    });
  }
}
