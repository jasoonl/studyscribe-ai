#!/usr/bin/env node
/**
 * Local stand-ins for the services Phase 5 part 2 talks to, so the API, slide
 * capture, the meeting note-taker, emailing attendees and teams can be
 * exercised end to end without keys or network. No dependencies.
 *
 * - Recall.ai (`/recall/api/v1`, the base for RECALL_API_BASE): create, read,
 *   leave, delete and delete_media for bots. A bot sent "now" walks through
 *   joining_call -> in_call_recording -> call_ended -> done over ~12 seconds
 *   (MOCK_BOT_SECONDS), each step a Svix-signed webhook to
 *   MOCK_APP_URL/api/webhooks/recall (RECALL_WEBHOOK_SECRET). Its audio is a
 *   short WAV at /recall/media/<bot>.mp3. POST /_recall/replay resends the
 *   last webhook; POST /_recall/forged sends one with a bad signature.
 * - Legacy "Forge" storage (`/forge`, the base for BUILT_IN_FORGE_API_URL),
 *   kept in memory, so recordings and slides can be stored without Blob.
 * - Stripe (`/stripe/v1`): customers, Checkout Sessions with quantity,
 *   subscriptions (read, update quantity, cancel), portal sessions, and a
 *   hosted checkout page whose "Subscribe" sends signed webhooks.
 * - Google sign-in (GOOGLE_SIGNIN_TEST_BASE_URL): an account chooser at
 *   /google-signin-authorize and /google-signin-token. Google OAuth and
 *   Calendar for INTEGRATIONS_TEST_BASE_URL, with attendees and a Meet link.
 * - WorkOS (`/workos`, the base for WORKOS_API_BASE): /sso/authorize shows an
 *   identity-provider page, /sso/token returns a profile, /portal/generate_link.
 * - Resend (`/resend/emails`), an OpenAI-compatible chat endpoint and
 *   AssemblyAI (`/assemblyai/transcript`, see redirect-assemblyai.mjs).
 * - GET /_log returns everything received.
 *
 * Usage:
 *   MOCK_APP_URL=http://localhost:3110 RECALL_WEBHOOK_SECRET=whsec_bW9jay1yZWNhbGw= STRIPE_WEBHOOK_SECRET=whsec_dev \
 *     node scripts/dev/mock-phase5-platform.mjs   (port 7076)
 * App environment: see "Phase 5 part 2" in CLAUDE.md.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 7076);
const appUrl = (process.env.MOCK_APP_URL || "http://localhost:3110").replace(/\/$/, "");
const recallSecret = process.env.RECALL_WEBHOOK_SECRET || "whsec_bW9jay1yZWNhbGw=";
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dev";
const botSeconds = Number(process.env.MOCK_BOT_SECONDS || 12);
const base = `http://127.0.0.1:${port}`;
const now = () => Math.floor(Date.now() / 1000);
const log = (...parts) => console.log("[mock-platform]", ...parts);

const state = { bots: new Map(), recallWebhooks: [], objects: new Map(), customers: new Map(), sessions: new Map(), subscriptions: new Map(), stripeEvents: [], emails: [], workos: [], chats: 0 };

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const page = (res, body) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;margin:40px auto;max-width:520px;padding:0 16px;color:#111}a.button,button{display:block;font:inherit;padding:10px 14px;margin:8px 0;border-radius:8px;border:1px solid #888;background:#fff;color:#111;text-decoration:none;cursor:pointer}small{color:#555}</style>${body}`);
};

/** A one-second 8kHz WAV tone, standing in for a meeting's audio. */
function wav(seconds = 3) {
  const rate = 8000;
  const samples = rate * seconds;
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
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  return buffer;
}

// ------------------------------------------------------------------ Recall

function signRecall(id, timestamp, body) {
  const key = Buffer.from(recallSecret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

async function sendRecallWebhook(bot, code, { forge = false } = {}) {
  const body = JSON.stringify({ event: `bot.${code}`, data: { bot: { id: bot.id, metadata: bot.metadata }, data: { code, sub_code: null, updated_at: new Date().toISOString() } } });
  const id = `msg_${randomUUID().slice(0, 12)}`;
  const timestamp = now();
  const signature = forge ? "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : signRecall(id, timestamp, body);
  try {
    const response = await fetch(`${appUrl}/api/webhooks/recall`, { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": signature }, body });
    const text = await response.text();
    state.recallWebhooks.push({ bot: bot.id, code, forged: forge, status: response.status, body: text.slice(0, 160) });
    log("recall webhook", code, forge ? "(forged)" : "", "->", response.status, text.slice(0, 100));
    return { status: response.status, body: text, payload: body, headers: { id, timestamp, signature } };
  } catch (error) {
    log("recall webhook failed", error.message);
    return { status: 0 };
  }
}

function botObject(bot) {
  return {
    id: bot.id,
    meeting_url: bot.meeting_url,
    bot_name: bot.bot_name,
    join_at: bot.join_at ?? null,
    metadata: bot.metadata,
    status_changes: bot.statuses.map((code) => ({ code, sub_code: null, created_at: new Date().toISOString() })),
    recordings: bot.statuses.includes("done") && !bot.mediaDeleted ? [{ id: `rec_${bot.id}`, media_shortcuts: { audio_mixed: { data: { download_url: `${base}/recall/media/${bot.id}.mp3` } } } }] : [],
  };
}

function runBot(bot) {
  const steps = [["joining_call", 0.1], ["in_call_recording", 0.3], ["call_ended", 0.85], ["done", 1]];
  for (const [code, fraction] of steps) {
    setTimeout(async () => {
      if (bot.cancelled) return;
      if (code === "call_ended" && bot.left) return;
      bot.statuses.push(code);
      await sendRecallWebhook(bot, code);
    }, botSeconds * 1000 * fraction);
  }
}

// ------------------------------------------------------------------ Stripe

function parseForm(body) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const keys = rawKey.replace(/\]/g, "").split("[");
    let node = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) node[key] = value;
      else node = node[key] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
    });
  }
  return out;
}

function subscriptionObject(sub) {
  return {
    id: sub.id,
    object: "subscription",
    customer: sub.customer,
    status: sub.status,
    cancel_at_period_end: false,
    metadata: sub.metadata,
    items: { data: [{ id: `si_${sub.id}`, quantity: sub.quantity, price: { id: sub.price }, current_period_start: sub.periodStart, current_period_end: sub.periodEnd }] },
  };
}

async function sendStripeEvent(type, object) {
  const event = { id: `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`, object: "event", type, created: now(), data: { object } };
  state.stripeEvents.push(event);
  const payload = JSON.stringify(event);
  const t = now();
  const signature = createHmac("sha256", stripeSecret).update(`${t}.${payload}`).digest("hex");
  const response = await fetch(`${appUrl}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${signature}` }, body: payload }).catch((error) => ({ status: 0, text: async () => error.message }));
  log("stripe webhook", type, "->", response.status, (await response.text()).slice(0, 100));
}

// ----------------------------------------------------------------- calendar

function calendarEvents() {
  const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  const attendees = [
    { email: "student@example.com", self: true, responseStatus: "accepted" },
    { email: "ben@school.edu", displayName: "Ben Carter", responseStatus: "accepted" },
    { email: "cleo@gmail.com", displayName: "Cleo Park", responseStatus: "tentative" },
    { email: "dev@school.edu", displayName: "Dev Shah", responseStatus: "needsAction" },
    { email: "room-204@resource.calendar.google.com", resource: true },
  ];
  return [
    { id: "evt-sync-now", status: "confirmed", summary: "Lab group sync", start: { dateTime: at(-10) }, end: { dateTime: at(50) }, hangoutLink: "https://meet.google.com/abc-defg-hij", attendees },
    { id: "evt-seminar", status: "confirmed", summary: "Chemistry 210 seminar", start: { dateTime: at(90) }, end: { dateTime: at(150) }, conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://us02web.zoom.us/j/81234567890" }] }, attendees },
    { id: "evt-hist", status: "confirmed", summary: "History of Science", location: "Room 12", start: { dateTime: at(60 * 26) }, end: { dateTime: at(60 * 27) } },
  ];
}

function chatReply(payload) {
  const prompt = JSON.stringify(payload.messages ?? []);
  if (/flashcard/i.test(prompt)) return JSON.stringify([{ question: "What do mitochondria make?", answer: "ATP", difficulty: "easy" }]);
  return "## Summary\n- Mitochondria make ATP, the energy molecule.\n- Plants also capture light in chloroplasts.\n\n## Next steps\n- Ben shares the lab protocol by Friday.";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", base);
  const path = url.pathname;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const body = raw.toString("utf8");

  if (path === "/_log") {
    return json(res, 200, {
      bots: [...state.bots.values()].map((bot) => ({ id: bot.id, name: bot.bot_name, statuses: bot.statuses, joinAt: bot.join_at, chat: bot.chat, recording_config: bot.recording_config, mediaDeleted: !!bot.mediaDeleted, left: !!bot.left, cancelled: !!bot.cancelled })),
      recallWebhooks: state.recallWebhooks,
      objects: [...state.objects.entries()].map(([key, value]) => ({ key, bytes: value.length })),
      customers: [...state.customers.values()],
      subscriptions: [...state.subscriptions.values()],
      emails: state.emails,
      workos: state.workos,
    });
  }

  // ---------------------------------------------------------------- Recall
  if (path.startsWith("/recall/api/v1/")) {
    if (req.headers.authorization !== "Token recall-dev") return json(res, 401, { detail: "Invalid token." });
    const route = path.slice("/recall/api/v1".length);
    if (req.method === "POST" && route === "/bot/") {
      const input = JSON.parse(body || "{}");
      if (!/^https:\/\//.test(input.meeting_url ?? "")) return json(res, 400, { meeting_url: ["Invalid meeting URL."] });
      const bot = { ...input, id: `bot_${randomUUID().slice(0, 8)}`, statuses: ["ready"] };
      state.bots.set(bot.id, bot);
      log("bot created", bot.id, bot.bot_name, bot.join_at ? `joins at ${bot.join_at}` : "joins now");
      if (!bot.join_at) runBot(bot);
      return json(res, 201, botObject(bot));
    }
    const match = route.match(/^\/bot\/([^/]+)\/(leave_call\/|delete_media\/)?$/);
    const bot = match ? state.bots.get(match[1]) : null;
    if (!bot) return json(res, 404, { detail: "Not found." });
    if (req.method === "GET" && !match[2]) return json(res, 200, botObject(bot));
    if (req.method === "DELETE" && !match[2]) {
      bot.cancelled = true;
      return json(res, 204, {});
    }
    if (req.method === "POST" && match[2] === "leave_call/") {
      bot.left = true;
      bot.statuses.push("call_ended");
      setTimeout(async () => {
        await sendRecallWebhook(bot, "call_ended");
        bot.statuses.push("done");
        await sendRecallWebhook(bot, "done");
      }, 500);
      return json(res, 200, botObject(bot));
    }
    if (req.method === "POST" && match[2] === "delete_media/") {
      bot.mediaDeleted = true;
      log("media deleted", bot.id);
      return json(res, 200, {});
    }
  }
  if (path.startsWith("/recall/media/")) {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    return res.end(wav(3));
  }
  if (req.method === "POST" && path === "/_recall/replay") {
    const bot = [...state.bots.values()].pop();
    return bot ? json(res, 200, await sendRecallWebhook(bot, bot.statuses[bot.statuses.length - 1])) : json(res, 404, {});
  }
  if (req.method === "POST" && path === "/_recall/forged") {
    const bot = [...state.bots.values()].pop() ?? { id: "bot_none", metadata: {} };
    return json(res, 200, await sendRecallWebhook(bot, "fatal", { forge: true }));
  }

  // --------------------------------------------------------------- storage
  if (path === "/forge/v1/storage/presign/put" || path === "/forge/v1/storage/presign/get") {
    const key = url.searchParams.get("path");
    return json(res, 200, { url: `${base}/forge/object/${encodeURIComponent(key)}` });
  }
  if (path.startsWith("/forge/object/")) {
    const key = decodeURIComponent(path.slice("/forge/object/".length));
    if (req.method === "PUT") {
      state.objects.set(key, raw);
      return json(res, 200, {});
    }
    const data = state.objects.get(key);
    if (!data) return json(res, 404, { error: "no object" });
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = Number(range[1] || 0);
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      res.writeHead(206, { "content-type": "application/octet-stream", "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": end - start + 1 });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": data.length });
    return res.end(data);
  }

  // ---------------------------------------------------------------- Stripe
  if (path.startsWith("/stripe/v1/")) {
    const route = path.slice("/stripe/v1".length);
    if (req.headers.authorization !== "Bearer sk_test_dev") return json(res, 401, { error: { message: "Invalid API Key provided" } });
    const form = parseForm(body);
    if (req.method === "POST" && route === "/customers") {
      const id = `cus_mock_${state.customers.size + 1}`;
      state.customers.set(id, { id, email: form.email, name: form.name, metadata: form.metadata });
      return json(res, 200, { id });
    }
    if (req.method === "DELETE" && route.startsWith("/customers/")) return json(res, 200, { deleted: true });
    if (req.method === "POST" && route === "/checkout/sessions") {
      const id = `cs_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      state.sessions.set(id, { id, ...form });
      return json(res, 200, { id, url: `${base}/stripe-checkout/${id}` });
    }
    if (route.startsWith("/subscriptions/")) {
      const sub = state.subscriptions.get(route.split("/")[2]);
      if (!sub) return json(res, 404, { error: { message: "No such subscription" } });
      if (req.method === "GET") return json(res, 200, subscriptionObject(sub));
      if (req.method === "POST") {
        if (form.items?.[0]?.quantity) sub.quantity = Number(form.items[0].quantity);
        log("subscription", sub.id, "quantity", sub.quantity, "proration", form.proration_behavior);
        await sendStripeEvent("customer.subscription.updated", subscriptionObject(sub));
        return json(res, 200, subscriptionObject(sub));
      }
      if (req.method === "DELETE") {
        sub.status = "canceled";
        await sendStripeEvent("customer.subscription.deleted", subscriptionObject(sub));
        return json(res, 200, subscriptionObject(sub));
      }
    }
    if (req.method === "POST" && route === "/billing_portal/sessions") return json(res, 200, { url: `${base}/stripe-portal?return_url=${encodeURIComponent(form.return_url)}` });
    return json(res, 404, { error: { message: `mock Stripe has no ${req.method} ${route}` } });
  }
  const checkout = path.match(/^\/stripe-checkout\/([^/]+)(\/pay)?$/);
  if (checkout) {
    const session = state.sessions.get(checkout[1]);
    if (!session) return json(res, 404, {});
    const item = session.line_items?.[0] ?? {};
    if (!checkout[2]) {
      return page(res, `<h1>Mock Stripe Checkout</h1><p>${item.price} x ${item.quantity ?? 1}</p><p><small>${session.custom_text?.submit?.message ?? ""}</small></p><form method="post" action="/stripe-checkout/${session.id}/pay"><button>Subscribe</button></form>`);
    }
    const subId = `sub_mock_${state.subscriptions.size + 1}`;
    const sub = { id: subId, customer: session.customer, status: "active", price: item.price, quantity: Number(item.quantity ?? 1), periodStart: now(), periodEnd: now() + 30 * 86400, metadata: session.subscription_data?.metadata ?? {} };
    state.subscriptions.set(subId, sub);
    await sendStripeEvent("customer.subscription.created", subscriptionObject(sub));
    await sendStripeEvent("checkout.session.completed", { id: session.id, mode: "subscription", customer: session.customer, subscription: subId, client_reference_id: session.client_reference_id, metadata: session.metadata });
    res.writeHead(303, { location: session.success_url });
    return res.end();
  }
  if (path === "/stripe-portal") return page(res, `<h1>Mock billing portal</h1><a class="button" href="${url.searchParams.get("return_url")}">Return to StudyScribe</a>`);

  // --------------------------------------------------------- Google sign-in
  if (path === "/google-signin-authorize") {
    const accounts = [
      ["newperson@gmail.com", "New Person", ""],
      ["invited@school.edu", "Ivy Invited", "school.edu"],
      ["walkin@school.edu", "Wren Walkin", "school.edu"],
      ["ana@school.edu", "Ana Lopez", "school.edu"],
    ];
    const back = (email, name, hd) => {
      const target = new URL(url.searchParams.get("redirect_uri"));
      target.searchParams.set("code", Buffer.from(JSON.stringify({ email, name, hd })).toString("base64url"));
      target.searchParams.set("state", url.searchParams.get("state") ?? "");
      return target.toString();
    };
    return page(res, `<h1>Choose an account</h1><p><small>Mock Google sign-in</small></p>${accounts.map(([email, name, hd]) => `<a class="button" href="${back(email, name, hd)}">${name} <small>${email}${hd ? " (Workspace)" : ""}</small></a>`).join("")}`);
  }
  if (req.method === "POST" && path === "/google-signin-token") {
    const { code } = JSON.parse(body || "{}");
    const account = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
    return json(res, 200, { sub: `google-${account.email}`, email: account.email, name: account.name, ...(account.hd ? { hd: account.hd } : {}) });
  }

  // ------------------------------------------------------ Google Calendar OAuth
  if (path === "/google-authorize") {
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", "code-calendar");
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: redirect.toString() });
    return res.end();
  }
  if (path === "/google-token") return json(res, 200, { access_token: "ya29.mock-calendar", expires_in: 3599, refresh_token: "1//mock-refresh", scope: "https://www.googleapis.com/auth/calendar.readonly", token_type: "Bearer" });
  if (path === "/google-revoke") return json(res, 200, {});
  if (path === "/google-calendar/calendars/primary") return json(res, 200, { id: "student@example.com", summary: "student@example.com" });
  if (path === "/google-calendar/calendars/primary/events") {
    const min = Date.parse(url.searchParams.get("timeMin") ?? "1970-01-01");
    const max = Date.parse(url.searchParams.get("timeMax") ?? "2999-01-01");
    return json(res, 200, { items: calendarEvents().filter((event) => Date.parse(event.end.dateTime) > min && Date.parse(event.start.dateTime) < max) });
  }

  // ------------------------------------------------------------------ WorkOS
  if (path === "/workos/sso/authorize") {
    state.workos.push({ step: "authorize", organization: url.searchParams.get("organization"), client: url.searchParams.get("client_id") });
    const target = new URL(url.searchParams.get("redirect_uri"));
    target.searchParams.set("state", url.searchParams.get("state") ?? "");
    const as = (email, org) => {
      const t = new URL(target);
      t.searchParams.set("code", Buffer.from(JSON.stringify({ email, org })).toString("base64url"));
      return t.toString();
    };
    const org = url.searchParams.get("organization");
    const hint = url.searchParams.get("login_hint") ?? "sam@school.edu";
    return page(res, `<h1>Mock identity provider</h1><p><small>WorkOS organisation ${org}</small></p><a class="button" href="${as(hint, org)}">Sign in as ${hint}</a><a class="button" href="${as(hint, "org_someone_else")}">Sign in from another organisation</a>`);
  }
  if (req.method === "POST" && path === "/workos/sso/token") {
    const form = new URLSearchParams(body);
    if (form.get("client_secret") !== "sk_workos_dev") return json(res, 401, { error: "invalid_client" });
    const { email, org } = JSON.parse(Buffer.from(form.get("code") ?? "", "base64url").toString("utf8"));
    state.workos.push({ step: "token", email, org });
    return json(res, 200, { access_token: "workos-token", profile: { id: `prof_${email}`, email, first_name: "Sam", last_name: "Rivera", organization_id: org, connection_id: "conn_mock" } });
  }
  if (req.method === "POST" && path === "/workos/portal/generate_link") {
    const input = JSON.parse(body || "{}");
    return json(res, 200, { link: `${base}/workos/portal?organization=${input.organization}&intent=${input.intent}` });
  }
  if (path === "/workos/portal") return page(res, `<h1>Mock WorkOS Admin Portal</h1><p>Connect an identity provider for ${url.searchParams.get("organization")}.</p>`);

  // ---------------------------------------------------------- Resend, LLM, ASR
  if (path === "/resend/emails") {
    const payload = JSON.parse(body || "{}");
    const unsubscribe = payload.headers?.["List-Unsubscribe"] ?? null;
    state.emails.push({ to: payload.to, from: payload.from, replyTo: payload.reply_to, subject: payload.subject, unsubscribe, oneClick: payload.headers?.["List-Unsubscribe-Post"] ?? null, hasPostal: /1 Main Street/.test(payload.html ?? ""), links: [...(payload.html ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")) });
    log("email", payload.subject, "to", payload.to?.join(", "));
    return json(res, 200, { id: `email_${randomUUID().slice(0, 8)}` });
  }
  if (path === "/v1/chat/completions") {
    state.chats += 1;
    const payload = JSON.parse(body || "{}");
    return json(res, 200, { id: `chat-${state.chats}`, object: "chat.completion", created: now(), model: "mock", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: chatReply(payload) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }
  if (req.method === "POST" && path === "/assemblyai/transcript") return json(res, 200, { id: `mock-${randomUUID().slice(0, 8)}`, status: "queued" });
  if (path.startsWith("/assemblyai/transcript/")) {
    const lines = ["Thanks everyone for joining the lab group sync.", "Mitochondria produce adenosine triphosphate, the molecule cells spend to do work.", "Can you share the protocol by Friday?", "Yes, I'll send it to the group."];
    const utterances = lines.map((text, i) => ({ speaker: i % 2 ? "B" : "A", start: i * 15_000, end: i * 15_000 + 12_000, text, confidence: 0.95, words: [] }));
    return json(res, 200, { id: path.split("/").pop(), status: "completed", text: lines.join(" "), language_code: "en", utterances });
  }

  json(res, 404, { error: `mock has no ${req.method} ${path}` });
});

server.listen(port, "127.0.0.1", () => log(`listening on ${base}; webhooks go to ${appUrl}`));
