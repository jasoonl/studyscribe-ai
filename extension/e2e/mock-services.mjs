#!/usr/bin/env node
/**
 * Local stand-ins for the end-to-end test (no keys, no network):
 *
 * - "Forge" storage, the server's fallback when no Blob store is configured
 *   (BUILT_IN_FORGE_API_URL): presign put/get and an in-memory object store.
 * - AssemblyAI submission and status (with scripts/dev/redirect-assemblyai.mjs
 *   and MOCK_ASSEMBLYAI_URL=http://127.0.0.1:7090/assemblyai), so
 *   `recordings.create` completes its provider submission.
 * - /lecture.html, a page that plays a tone on loop, for "Record this tab".
 * - /_log, what was stored and submitted, for assertions.
 *
 *   node e2e/mock-services.mjs [port]   (default 7090)
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 7090);
const objects = new Map();
const log = { stored: [], transcripts: [] };

function wav(seconds = 6, rate = 16000) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    // A 440 Hz tone that swells and fades once a second, loud enough to measure.
    const envelope = 0.35 + 0.25 * Math.sin((2 * Math.PI * i) / rate);
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * envelope * 32767), 44 + i * 2);
  }
  return buffer;
}
const TONE = wav();

const LECTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lecture 7: Enzyme kinetics</title></head>
<body><h1>Lecture 7: Enzyme kinetics</h1><audio id="a" src="/lecture.wav" autoplay loop controls></audio>
<script>document.getElementById("a").play().catch(() => {});</script></body></html>`;

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const base = `http://127.0.0.1:${port}`;

  if (path === "/v1/storage/presign/put" || path === "/v1/storage/presign/get") {
    return json(res, 200, { url: `${base}/obj/${encodeURIComponent(url.searchParams.get("path") || "")}` });
  }
  if (path.startsWith("/obj/")) {
    const key = decodeURIComponent(path.slice(5));
    if (req.method === "PUT") {
      const body = await readBody(req);
      objects.set(key, { body, type: req.headers["content-type"] || "application/octet-stream" });
      log.stored.push({ key, size: body.length, type: req.headers["content-type"] });
      res.writeHead(200);
      return res.end();
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": object.type, "Content-Length": object.body.length });
    return res.end(object.body);
  }
  if (path === "/assemblyai/transcript" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const id = `mock-ext-${log.transcripts.length + 1}`;
    log.transcripts.push({ id, audio_url: body.audio_url, language_code: body.language_code });
    return json(res, 200, { id, status: "queued" });
  }
  if (path.startsWith("/assemblyai/transcript/")) {
    return json(res, 200, { id: path.split("/").pop(), status: "processing" });
  }
  if (path === "/lecture.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(LECTURE);
  }
  if (path === "/lecture.wav") {
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": TONE.length });
    return res.end(TONE);
  }
  if (path.startsWith("/_object/")) {
    const object = objects.get(decodeURIComponent(path.slice(9)));
    if (!object) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    return res.end(object.body);
  }
  if (path === "/_log") return json(res, 200, log);
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`[mock] storage, AssemblyAI and a lecture page on http://127.0.0.1:${port}`));
