import { describe, expect, it } from "vitest";
import { LiveTranscriber, LiveUnavailableError, describeClose, type LiveStatus, type SocketLike } from "./liveTranscription";
import type { LiveTurn } from "./liveTurns";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  sent: Array<string | ArrayBuffer> = [];
  closedWith: number | null = null;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(readonly url: string) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    this.onclose?.({ code, reason: "" });
  }
  // Test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  get audio() {
    return this.sent.filter(item => item instanceof ArrayBuffer) as ArrayBuffer[];
  }
  get texts() {
    return this.sent.filter(item => typeof item === "string") as string[];
  }
}

function setup(options: { tokenError?: Error } = {}) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ id: number; callback: () => void; ms: number; cleared: boolean }> = [];
  let turns: LiveTurn[] = [];
  const statuses: Array<[LiveStatus, string | null]> = [];
  let elapsed = 0;
  let tokens = 0;
  const transcriber = new LiveTranscriber({
    getToken: async () => {
      tokens++;
      if (options.tokenError) throw options.tokenError;
      return { token: `t${tokens}`, socketUrl: "wss://streaming.test/v3/ws?sample_rate=16000", maxSessionSeconds: 3600 };
    },
    getElapsedSeconds: () => elapsed,
    onTurns: update => {
      turns = update(turns);
    },
    onStatus: (status, message) => statuses.push([status, message]),
    createSocket: url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, ms) => {
      const timer = { id: timers.length, callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: handle => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  const runTimer = (ms: number) => {
    const timer = timers.find(t => !t.cleared && t.ms === ms);
    if (!timer) throw new Error(`no timer of ${ms}ms`);
    timer.cleared = true;
    timer.callback();
  };
  return {
    transcriber,
    sockets,
    timers,
    statuses,
    flush,
    runTimer,
    get turns() {
      return turns;
    },
    setElapsed: (value: number) => {
      elapsed = value;
    },
    get tokens() {
      return tokens;
    },
  };
}

const chunk = (value = 1) => new Int16Array(1600).fill(value).buffer;

describe("LiveTranscriber", () => {
  it("connects with the token, queues audio until Begin, then streams", async () => {
    const t = setup();
    t.transcriber.start();
    t.transcriber.pushAudio(chunk(1));
    await t.flush();
    expect(t.sockets).toHaveLength(1);
    expect(t.sockets[0].url).toBe("wss://streaming.test/v3/ws?sample_rate=16000&token=t1");
    expect(t.sockets[0].binaryType).toBe("arraybuffer");
    t.sockets[0].open();
    t.transcriber.pushAudio(chunk(2));
    expect(t.sockets[0].audio).toHaveLength(0);
    t.sockets[0].receive({ type: "Begin", id: "s1", expires_at: 0 });
    expect(t.sockets[0].audio.map(buffer => new Int16Array(buffer)[0])).toEqual([1, 2]);
    t.transcriber.pushAudio(chunk(3));
    expect(t.sockets[0].audio).toHaveLength(3);
    expect(t.statuses.at(-1)).toEqual(["live", null]);
  });

  it("builds the transcript from Turn messages", async () => {
    const t = setup();
    t.transcriber.start();
    await t.flush();
    t.sockets[0].open();
    t.sockets[0].receive({ type: "Begin" });
    t.sockets[0].receive({ type: "Turn", turn_order: 0, transcript: "hello every", end_of_turn: false, turn_is_formatted: false, words: [] });
    t.sockets[0].receive({ type: "Turn", turn_order: 0, transcript: "Hello everyone.", end_of_turn: true, turn_is_formatted: true, words: [] });
    expect(t.turns.map(turn => [turn.text, turn.final])).toEqual([["Hello everyone.", true]]);
  });

  it("terminates the session on pause and opens a new one on resume", async () => {
    const t = setup();
    t.transcriber.start();
    await t.flush();
    t.sockets[0].open();
    t.sockets[0].receive({ type: "Begin" });
    t.transcriber.pause();
    expect(t.sockets[0].texts).toContain(JSON.stringify({ type: "Terminate" }));
    t.transcriber.pushAudio(chunk());
    expect(t.sockets[0].audio).toHaveLength(0);
    t.sockets[0].receive({ type: "Termination" });
    expect(t.sockets[0].closedWith).toBe(1000);
    t.setElapsed(120);
    t.transcriber.resume();
    await t.flush();
    expect(t.sockets).toHaveLength(2);
    expect(t.statuses.map(([status]) => status)).toContain("paused");
  });

  it("reconnects with backoff after an unexpected close, and gives up eventually", async () => {
    const t = setup();
    t.transcriber.start();
    await t.flush();
    t.sockets[0].open();
    t.sockets[0].receive({ type: "Begin" });
    t.sockets[0].drop(1006);
    expect(t.statuses.at(-1)?.[0]).toBe("reconnecting");
    t.runTimer(1000);
    await t.flush();
    expect(t.sockets).toHaveLength(2);
    // Keep failing before Begin.
    for (const delay of [2_000, 5_000, 10_000, 20_000, 30_000]) {
      t.sockets.at(-1)!.drop(1006);
      t.runTimer(delay);
      await t.flush();
    }
    t.sockets.at(-1)!.drop(1006);
    expect(t.statuses.at(-1)?.[0]).toBe("error");
  });

  it("does not retry when the service refuses the credentials", async () => {
    const t = setup();
    t.transcriber.start();
    await t.flush();
    t.sockets[0].drop(1008);
    expect(t.statuses.at(-1)?.[0]).toBe("error");
    expect(t.timers.filter(timer => !timer.cleared)).toHaveLength(0);
  });

  it("stops quietly when the server has no live transcription", async () => {
    const t = setup({ tokenError: new LiveUnavailableError("Live transcription is not set up on this server.") });
    t.transcriber.start();
    await t.flush();
    expect(t.sockets).toHaveLength(0);
    expect(t.statuses.at(-1)).toEqual(["unavailable", "Live transcription is not set up on this server."]);
  });

  it("rolls over to a fresh session before the cap without dropping audio", async () => {
    const t = setup();
    t.transcriber.start();
    await t.flush();
    t.sockets[0].open();
    t.sockets[0].receive({ type: "Begin" });
    t.setElapsed(3510);
    t.runTimer((3600 - 90) * 1000);
    await t.flush();
    expect(t.sockets).toHaveLength(2);
    // Until the new session begins, audio keeps going to the old one.
    t.transcriber.pushAudio(chunk());
    expect(t.sockets[0].audio).toHaveLength(1);
    t.sockets[1].open();
    t.sockets[1].receive({ type: "Begin" });
    expect(t.sockets[0].texts).toContain(JSON.stringify({ type: "Terminate" }));
    t.transcriber.pushAudio(chunk());
    expect(t.sockets[1].audio).toHaveLength(1);
    t.sockets[1].receive({ type: "Turn", turn_order: 0, transcript: "Next hour.", end_of_turn: true, turn_is_formatted: true, words: [{ start: 1000, end: 2000 }] });
    expect(t.turns.at(-1)).toMatchObject({ startAt: 3511, endAt: 3512 });
  });

  it("reopens immediately when a session hits its cap", async () => {
    const t = setup();
    t.transcriber.start();
    await t.flush();
    t.sockets[0].open();
    t.sockets[0].receive({ type: "Begin" });
    t.sockets[0].drop(3008);
    await t.flush();
    expect(t.sockets).toHaveLength(2);
  });
});

describe("describeClose", () => {
  it("stops on authorisation failures and retries the rest", () => {
    expect(describeClose(1008, null).retry).toBe(false);
    expect(describeClose(1006, null)).toEqual({ retry: true, message: null });
    expect(describeClose(3009, null).retry).toBe(true);
  });
});
