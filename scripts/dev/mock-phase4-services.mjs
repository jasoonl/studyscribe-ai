#!/usr/bin/env node
/**
 * Local stand-ins for the services Phase 4 talks to, so collaboration and
 * integrations can be exercised end to end without keys or network:
 *
 * - OpenAI-compatible POST /v1/embeddings: deterministic bag-of-words vectors
 *   with a few synonym groups (so "ATP" and "adenosine triphosphate" land
 *   close together), and POST /v1/chat/completions that cites excerpt [1].
 * - A webhook receiver at POST /hooks/<name>: verifies the StudyScribe
 *   signature when MOCK_WEBHOOK_SECRET is set, and answers with the status in
 *   ?status= (default 204). /hooks/flaky fails the first two deliveries.
 * - Notion and Google OAuth + API endpoints, named the way
 *   INTEGRATIONS_TEST_BASE_URL expects (`<base>/notion-authorize`, ...). The
 *   authorize endpoints redirect straight back with a code, as if the person
 *   had clicked "Allow".
 * - GET /_log returns everything received, for test assertions.
 *
 * Usage:
 *   node scripts/dev/mock-phase4-services.mjs [port]     (default 7072)
 * then run the app with
 *   OPENAI_API_KEY=dev OPENAI_BASE_URL=http://127.0.0.1:7072/v1 OPENAI_EMBEDDING_MODEL=mock-embed \
 *   NOTION_CLIENT_ID=dev NOTION_CLIENT_SECRET=dev GOOGLE_CLIENT_ID=dev GOOGLE_CLIENT_SECRET=dev \
 *   INTEGRATIONS_TEST_BASE_URL=http://127.0.0.1:7072 WEBHOOKS_ALLOW_PRIVATE_TARGETS=true npm run dev
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 7072);
const webhookSecret = process.env.MOCK_WEBHOOK_SECRET || "";
const DIMS = 256;
const received = { embeddings: 0, chats: 0, webhooks: [], notion: [], google: [] };
let flakyCount = 0;

const LECTURE = [
  "Today we look at how cells make energy.",
  "Mitochondria produce adenosine triphosphate, the molecule cells spend to do work.",
  "Is that the same in plant cells?",
  "Plants also have chloroplasts, where photosynthesis captures light.",
  "This will be on the midterm, so learn both organelles.",
];
/** Seconds of speech for each line; the gaps between them are silent in /audio.wav. */
const SPEECH = [
  [1, 5],
  [5.5, 14],
  [22, 25],
  [25.5, 36],
  [48, 58],
];

function buildWav(seconds, rate = 8000) {
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
    const t = i / rate;
    const speaking = SPEECH.some(([from, to]) => t >= from && t < to);
    buffer.writeInt16LE(speaking ? Math.round(6000 * Math.sin(2 * Math.PI * 220 * t)) : 0, 44 + i * 2);
  }
  return buffer;
}
const AUDIO = buildWav(60);

const SYNONYMS = [
  ["atp", "adenosine", "triphosphate", "energy", "currency"],
  ["mitochondria", "mitochondrion", "powerhouse"],
  ["photosynthesis", "chloroplast", "chloroplasts", "light"],
  ["dna", "genetic", "gene", "genes", "chromosome"],
  ["exam", "midterm", "test", "final"],
];
const canonical = new Map(SYNONYMS.flatMap(group => group.map(word => [word, group[0]])));

function hash(word) {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % DIMS;
}

function embed(text) {
  const vector = new Array(DIMS).fill(0);
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    const word = canonical.get(raw) ?? raw.replace(/s$/, "");
    vector[hash(word)] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / norm);
}

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function log(...args) {
  console.log(`[mock4 ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

function verify(body, header) {
  if (!webhookSecret || !header) return null;
  const parts = Object.fromEntries(header.split(",").map(part => part.split("=")));
  const expected = createHmac("sha256", webhookSecret).update(`${parts.t}.${body}`).digest("hex");
  return expected === parts.v1;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const body = req.method === "POST" || req.method === "PATCH" ? await readBody(req) : "";
  const path = url.pathname;

  if (path === "/_log") return json(res, 200, received);

  if (path === "/v1/embeddings") {
    const input = JSON.parse(body).input;
    const list = Array.isArray(input) ? input : [input];
    received.embeddings += list.length;
    return json(res, 200, { data: list.map((text, index) => ({ index, embedding: embed(text) })), model: "mock-embed" });
  }

  if (path === "/v1/chat/completions") {
    received.chats += 1;
    const messages = JSON.parse(body).messages ?? [];
    const system = messages[0]?.content ?? "";
    const content = system.includes("Excerpts:")
      ? "From your lectures: cells make ATP, the energy currency, in the mitochondria [1]. The related passage explains it in other words [2]."
      : "## Summary\n\n- **Mitochondria** make ATP, the cell's energy currency.\n- Photosynthesis happens in chloroplasts.\n\n1. Review the light reactions\n2. Practise labelling a cell";
    return json(res, 200, { id: randomUUID(), choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
  }

  if (path.startsWith("/hooks/")) {
    const name = path.slice("/hooks/".length);
    const signature = req.headers["studyscribe-signature"];
    const entry = {
      name,
      event: req.headers["studyscribe-event"],
      delivery: req.headers["studyscribe-delivery"],
      signatureValid: verify(body, signature),
      hasSignature: Boolean(signature),
      body: JSON.parse(body || "{}"),
      raw: body,
      signature: signature ?? null,
      at: new Date().toISOString(),
    };
    received.webhooks.push(entry);
    log("webhook", name, entry.event, entry.signatureValid === null ? "(unchecked)" : entry.signatureValid ? "signature ok" : "BAD SIGNATURE");
    if (name === "flaky" && flakyCount++ < 2) return json(res, 503, { error: "try later" });
    if (name === "redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      return res.end();
    }
    res.writeHead(Number(url.searchParams.get("status") || 204));
    return res.end();
  }

  // ------------------------------------------------------------ Notion
  if (path === "/notion-authorize" || path === "/google-authorize") {
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", `code-${randomUUID().slice(0, 8)}`);
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    received[path.startsWith("/notion") ? "notion" : "google"].push({ step: "authorize", scope: url.searchParams.get("scope"), owner: url.searchParams.get("owner") });
    res.writeHead(302, { location: redirect.toString() });
    return res.end();
  }
  if (path === "/notion-api/oauth/token") {
    received.notion.push({ step: "token", auth: req.headers.authorization?.slice(0, 10), body: JSON.parse(body) });
    return json(res, 200, { access_token: "secret_notion_token", token_type: "bearer", bot_id: "bot", workspace_name: "Study Workspace", workspace_id: "ws1" });
  }
  if (path === "/notion-api/search") {
    if (req.headers.authorization !== "Bearer secret_notion_token") return json(res, 401, { message: "unauthorized" });
    return json(res, 200, {
      results: [
        { object: "page", id: "page-1111", properties: { title: { type: "title", title: [{ plain_text: "Biology notebook" }] } } },
        { object: "page", id: "page-2222", properties: { Name: { type: "title", title: [{ plain_text: "Semester plan" }] } } },
      ],
    });
  }
  if (path === "/notion-api/pages") {
    const payload = JSON.parse(body);
    received.notion.push({ step: "create-page", parent: payload.parent, title: payload.properties?.title?.title?.[0]?.text?.content, blocks: payload.children?.length, types: payload.children?.map(block => block.type) });
    return json(res, 200, { id: "new-page-id", url: "https://www.notion.so/new-page-id" });
  }
  if (path.startsWith("/notion-api/blocks/")) {
    received.notion.push({ step: "append", blocks: JSON.parse(body).children?.length });
    return json(res, 200, { results: [] });
  }

  // ------------------------------------------------------------ Google
  if (path === "/google-token") {
    const form = new URLSearchParams(body);
    received.google.push({ step: "token", grant: form.get("grant_type") });
    return json(res, 200, { access_token: `ya29.mock-${randomUUID().slice(0, 6)}`, expires_in: 3599, refresh_token: form.get("grant_type") === "authorization_code" ? "1//mock-refresh" : undefined, scope: "https://www.googleapis.com/auth/drive.file", token_type: "Bearer" });
  }
  if (path === "/google-revoke") {
    received.google.push({ step: "revoke" });
    res.writeHead(200);
    return res.end();
  }
  if (path === "/google-drive/about") return json(res, 200, { user: { emailAddress: "student@example.com", displayName: "Student" } });
  if (path === "/google-upload") {
    const contentType = req.headers["content-type"] ?? "";
    received.google.push({ step: "upload", multipart: contentType.startsWith("multipart/related"), hasHtml: body.includes("text/html"), metadata: body.match(/\{"name":[^\n]*\}/)?.[0] });
    return json(res, 200, { id: "doc-123", webViewLink: "https://docs.google.com/document/d/doc-123/edit" });
  }

  // ------------------------------------------------------------ test fixtures
  // A finished AssemblyAI job, for a recording seeded as "processing" with a
  // provider id of mock-*. Reach it by redirecting api.assemblyai.com here
  // (see scripts/dev/redirect-assemblyai.mjs).
  if (path.startsWith("/assemblyai/transcript/")) {
    const utterances = LECTURE.map((text, index) => ({ speaker: index % 3 === 2 ? "B" : "A", start: SPEECH[index][0] * 1000, end: SPEECH[index][1] * 1000, text, confidence: 0.95 }));
    return json(res, 200, { id: path.split("/").pop(), status: "completed", text: LECTURE.join(" "), language_code: "en", utterances });
  }
  // 60 seconds of tones with long pauses, matching SPEECH, for Skip silence.
  if (path === "/audio.wav") {
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), AUDIO.length - 1) : AUDIO.length - 1;
    res.writeHead(range ? 206 : 200, {
      "content-type": "audio/wav",
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "access-control-allow-origin": "*",
      ...(range ? { "content-range": `bytes ${start}-${end}/${AUDIO.length}` } : {}),
    });
    return res.end(AUDIO.subarray(start, end + 1));
  }

  json(res, 404, { error: `mock has no ${req.method} ${path}` });
});

server.listen(port, "127.0.0.1", () => log(`listening on http://127.0.0.1:${port}`));
