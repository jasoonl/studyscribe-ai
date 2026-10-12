#!/usr/bin/env node
/**
 * Local stand-ins for the two services the live recording features call, so
 * they can be developed and tested without keys or network:
 *
 * - AssemblyAI Universal-Streaming (v3): GET /v3/token and the /v3/ws socket.
 *   It checks the token, the 16 kHz PCM16 format and the 50-1000 ms chunk
 *   size, and answers with Begin, partial and final Turn messages (a scripted
 *   lecture, advanced by the audio actually received) and Termination.
 * - An OpenAI-compatible POST /v1/chat/completions that returns canned study
 *   help, follow-up suggestions and anything else as plain text.
 *
 * No dependencies: the WebSocket server is the small subset of RFC 6455 the
 * browser client needs.
 *
 * Usage:
 *   node scripts/dev/mock-live-services.mjs [port]          (default 7071)
 * then run the app with
 *   ASSEMBLYAI_API_KEY=dev ASSEMBLYAI_STREAMING_HOST=http://127.0.0.1:7071 \
 *   OPENAI_API_KEY=dev OPENAI_BASE_URL=http://127.0.0.1:7071/v1 npm run dev
 *
 * Options (environment):
 *   MOCK_DROP_AFTER_SECONDS=n  close each session abnormally (1006-like) after n seconds of audio, to exercise reconnects
 *   MOCK_TOKEN_STATUS=401      make the token endpoint fail
 *   MOCK_SILENCE_IS_SPEECH=1   produce words even when the audio is silent
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 7071);
const dropAfter = Number(process.env.MOCK_DROP_AFTER_SECONDS || 0);
const silenceIsSpeech = process.env.MOCK_SILENCE_IS_SPEECH === "1";

const LECTURE = [
  "Today we are looking at photosynthesis, the process plants use to turn light into chemical energy.",
  "It happens in the chloroplasts, and it has two stages: the light reactions and the Calvin cycle.",
  "The light reactions take place in the thylakoid membranes and produce ATP and NADPH.",
  "Water is split during this stage, which is where the oxygen we breathe comes from.",
  "In the Calvin cycle, the enzyme rubisco fixes carbon dioxide into a three carbon sugar.",
  "Remember that the Calvin cycle does not need light directly, but it depends on the products of the light reactions.",
  "This will be on the midterm, so make sure you can draw both stages and label the inputs and outputs.",
  "For next week, read chapter eight and try the practice problems at the end of the chapter.",
];

const issuedTokens = new Map();
const stats = { tokens: 0, sessions: 0, chunks: 0, badChunks: 0, audioSeconds: 0, assists: 0 };

function log(...args) {
  console.log(`[mock ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

/* ------------------------------------------------------------------ */
/* Minimal WebSocket framing                                            */
/* ------------------------------------------------------------------ */

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function createSocketSession(socket, onFrame) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[maskOffset + (i % 4)];
      buffer = buffer.subarray(offset + length);
      if (opcode === 0x9) socket.write(encodeFrame(0xa, payload));
      else onFrame(opcode, payload);
    }
  });
  const api = {
    sendText(text) {
      if (!closed) socket.write(encodeFrame(0x1, text));
    },
    sendJson(value) {
      api.sendText(JSON.stringify(value));
    },
    close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      const body = Buffer.alloc(2 + Buffer.byteLength(reason));
      body.writeUInt16BE(code, 0);
      body.write(reason, 2);
      socket.write(encodeFrame(0x8, body));
      socket.end();
    },
    /** An abnormal drop: no close frame, like a network failure. */
    destroy() {
      closed = true;
      socket.destroy();
    },
    get closed() {
      return closed;
    },
  };
  socket.on("close", () => {
    closed = true;
  });
  socket.on("error", () => {
    closed = true;
  });
  return api;
}

/* ------------------------------------------------------------------ */
/* Streaming session                                                    */
/* ------------------------------------------------------------------ */

function startStreamingSession(ws, url) {
  const id = randomUUID();
  const sampleRate = Number(url.searchParams.get("sample_rate"));
  const encoding = url.searchParams.get("encoding");
  const model = url.searchParams.get("speech_model") || "universal-3-6-pro";
  const formatTurns = url.searchParams.get("format_turns") === "true";
  stats.sessions++;
  log(`session ${id.slice(0, 8)} opened (rate=${sampleRate}, encoding=${encoding}, model=${model}, format_turns=${formatTurns})`);
  if (sampleRate !== 16000 || encoding !== "pcm_s16le") {
    ws.sendJson({ type: "Error", error_code: 3006, error: "Invalid Message: expected sample_rate=16000&encoding=pcm_s16le" });
    ws.close(3006, "Invalid configuration");
    return () => {};
  }
  ws.sendJson({ type: "Begin", id, expires_at: Math.floor(Date.now() / 1000) + 3600, configuration: { model, api_version: "2025-05-12" } });

  let audioMs = 0;
  let speechMs = 0;
  let turnOrder = 0;
  let sentence = Math.floor(Math.random() * LECTURE.length);
  let wordIndex = 0;
  let turnStartMs = 0;
  let lastWordAtMs = 0;
  let peak = 0;
  const words = () => LECTURE[sentence % LECTURE.length].split(" ");

  const turnWords = (count, final) =>
    words()
      .slice(0, count)
      .map((text, index) => ({
        start: turnStartMs + index * 350,
        end: turnStartMs + index * 350 + 300,
        text: final ? text : text.toLowerCase().replace(/[.,]/g, ""),
        confidence: 0.95,
        word_is_final: final,
      }));

  const sendTurn = (final, formatted) => {
    const list = turnWords(wordIndex, final);
    const transcript = formatted ? words().slice(0, wordIndex).join(" ") : list.map(word => word.text).join(" ");
    ws.sendJson({
      type: "Turn",
      turn_order: turnOrder,
      turn_is_formatted: formatted,
      end_of_turn: final,
      transcript,
      end_of_turn_confidence: final ? 0.9 : 0.1,
      words: list,
      utterance: final ? transcript : "",
    });
  };

  const finishTurn = () => {
    if (wordIndex === 0) return;
    sendTurn(true, false);
    if (formatTurns) sendTurn(true, true);
    turnOrder++;
    sentence++;
    wordIndex = 0;
  };

  const onAudio = payload => {
    stats.chunks++;
    const ms = (payload.length / 2 / 16000) * 1000;
    if (ms < 50 || ms > 1000) {
      stats.badChunks++;
      ws.sendJson({ type: "Error", error_code: 3007, error: `Input duration violation: ${ms.toFixed(0)} ms. Expected between 50 and 1000 ms` });
      ws.close(3007, "Input duration violation");
      return;
    }
    let sumSquares = 0;
    for (let i = 0; i + 1 < payload.length; i += 2) {
      const sample = payload.readInt16LE(i) / 32768;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / (payload.length / 2));
    peak = Math.max(peak, rms);
    audioMs += ms;
    stats.audioSeconds += ms / 1000;
    const speaking = silenceIsSpeech || rms > 0.003;
    if (speaking) speechMs += ms;

    // About one word every 350 ms of speech.
    if (speaking && speechMs - lastWordAtMs >= 350) {
      lastWordAtMs = speechMs;
      if (wordIndex === 0) turnStartMs = Math.max(0, Math.round(audioMs - 300));
      wordIndex++;
      if (wordIndex >= words().length) finishTurn();
      else sendTurn(false, false);
    }
    if (dropAfter && audioMs >= dropAfter * 1000) {
      log(`session ${id.slice(0, 8)} dropping on purpose after ${(audioMs / 1000).toFixed(1)}s`);
      ws.destroy();
    }
  };

  const onText = text => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      ws.sendJson({ type: "Error", error_code: 3006, error: `Invalid JSON: ${text.slice(0, 40)}` });
      ws.close(3006, "Invalid JSON");
      return;
    }
    if (message.type === "Terminate") {
      finishTurn();
      ws.sendJson({ type: "Termination", audio_duration_seconds: Math.round(audioMs / 1000), session_duration_seconds: Math.round(audioMs / 1000) });
      log(`session ${id.slice(0, 8)} terminated by client after ${(audioMs / 1000).toFixed(1)}s of audio (peak rms ${peak.toFixed(3)})`);
      setTimeout(() => ws.close(1000, ""), 50);
    } else if (message.type === "ForceEndpoint") {
      finishTurn();
    }
  };

  return (opcode, payload) => {
    if (opcode === 0x2) onAudio(payload);
    else if (opcode === 0x1) onText(payload.toString("utf8"));
    else if (opcode === 0x8) {
      log(`session ${id.slice(0, 8)} closed by client (code ${payload.length >= 2 ? payload.readUInt16BE(0) : "none"})`);
      ws.close(1000);
    }
  };
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible chat completions                                   */
/* ------------------------------------------------------------------ */

function completionFor(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const user = messages.filter(m => m.role === "user").map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const schemaName = body.response_format?.json_schema?.name;
  if (schemaName === "follow_ups") {
    return JSON.stringify({
      items: [
        { kind: "review", title: "Review the two stages of photosynthesis", detail: "Redraw the light reactions and the Calvin cycle from memory, with inputs and outputs.", inDays: 1 },
        { kind: "practice", title: "Quiz yourself on where each stage happens", detail: "Go through this recording's flashcards and say each answer out loud before flipping.", inDays: 3 },
        { kind: "ask", title: "Ask why rubisco is so slow", detail: "Bring this to the next class or office hours.", inDays: 5 },
        { kind: "read", title: "Read chapter 8 and try the practice problems", detail: "The lecturer set this for next week.", inDays: 7 },
      ],
    });
  }
  if (body.response_format?.type === "json_schema") return JSON.stringify({ items: [] });
  if (/Live transcript/.test(user)) {
    stats.assists++;
    if (/Recap what was said/.test(user)) {
      return "- Photosynthesis turns light into chemical energy in the chloroplasts.\n- The light reactions in the thylakoids make **ATP** and **NADPH**, and split water.\n- The Calvin cycle uses rubisco to fix carbon dioxide.";
    }
    if (/exam or assignment/.test(user)) {
      return "1. **The two stages** and where each happens.\n2. **Inputs and outputs** of each stage.\n3. **Rubisco** fixes carbon dioxide in the Calvin cycle.";
    }
    if (/questions the student could ask/.test(user)) {
      return "1. Why does the Calvin cycle still stop in the dark if it doesn't need light directly?\n2. What limits how fast rubisco works?\n3. How does the oxygen from split water leave the leaf?";
    }
    if (/Answer this question/.test(user)) {
      return "Based on the lecture so far: the **light reactions** happen in the thylakoid membranes, while the **Calvin cycle** happens in the stroma.";
    }
    return "**Thylakoid membrane**: the inner membrane system of the chloroplast where the light reactions run. Think of it as the solar panel of the cell, where light energy is captured to make ATP and NADPH.";
  }
  return "This is a response from the local mock language model.";
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                          */
/* ------------------------------------------------------------------ */

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/v3/token") {
    if (!req.headers.authorization) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Missing Authorization header" }));
      return;
    }
    if (process.env.MOCK_TOKEN_STATUS) {
      res.writeHead(Number(process.env.MOCK_TOKEN_STATUS), { "content-type": "application/json" }).end(JSON.stringify({ error: "Mock failure" }));
      return;
    }
    const expires = Number(url.searchParams.get("expires_in_seconds"));
    const maxSession = Number(url.searchParams.get("max_session_duration_seconds") || 10800);
    if (!(expires >= 1 && expires <= 600) || !(maxSession >= 60 && maxSession <= 10800)) {
      res.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: "Invalid parameters" }));
      return;
    }
    const token = `mock-${randomUUID()}`;
    issuedTokens.set(token, Date.now() + expires * 1000);
    stats.tokens++;
    log(`token issued (expires_in_seconds=${expires}, max_session_duration_seconds=${maxSession})`);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token, expires_in_seconds: expires }));
    return;
  }
  if (req.method === "POST" && /\/chat\/completions$/.test(url.pathname)) {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // fall through with an empty body
      }
      const content = completionFor(body);
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            id: `mock-${randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model || "mock",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        );
      }, 400);
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/stats") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats));
    return;
  }
  res.writeHead(404).end("not found");
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const key = req.headers["sec-websocket-key"];
  if (url.pathname !== "/v3/ws" || typeof key !== "string") {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
  let handler = () => {};
  const ws = createSocketSession(socket, (opcode, payload) => handler(opcode, payload));
  const token = url.searchParams.get("token");
  const expiresAt = token ? issuedTokens.get(token) : undefined;
  if (!expiresAt || expiresAt < Date.now()) {
    ws.sendJson({ type: "Error", error_code: 1008, error: "Unauthorized Connection: invalid or expired token" });
    ws.close(1008, "Unauthorized Connection");
    return;
  }
  handler = startStreamingSession(ws, url);
});

server.listen(port, "127.0.0.1", () => log(`listening on http://127.0.0.1:${port} (token, ws and chat completions)`));
