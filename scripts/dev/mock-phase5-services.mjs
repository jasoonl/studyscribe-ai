#!/usr/bin/env node
/**
 * Local stand-ins for the services Phase 5 talks to, so billing, open
 * sign-up, translation and the calendar can be exercised end to end without
 * keys or network:
 *
 * - Stripe (`/stripe/v1/...`, the base for STRIPE_API_BASE): customers,
 *   Checkout Sessions, billing portal sessions and subscriptions, plus hosted
 *   pages that stand in for Checkout (`/stripe-checkout/<id>`) and the portal
 *   (`/stripe-portal/<customer>`). Paying, switching plan or cancelling there
 *   sends correctly signed webhooks to the app (MOCK_APP_URL +
 *   /api/stripe/webhook, signed with STRIPE_WEBHOOK_SECRET), in the same
 *   shapes Stripe uses. POST /_stripe/payment-failed?customer=cus_x sends
 *   invoice.payment_failed; POST /_stripe/replay resends the last event (to
 *   check idempotency); POST /_stripe/stale sends an older event.
 * - OpenAI-compatible POST /v1/chat/completions: translations come back
 *   tagged "[es]" line for line (honouring the translated_lines JSON schema),
 *   anything else gets short Markdown notes. Each call waits 400ms so
 *   progressive translation is visible.
 * - Google OAuth and Calendar, named the way INTEGRATIONS_TEST_BASE_URL
 *   expects: `/google-authorize` redirects straight back with a code,
 *   `/google-token`, `/google-revoke`, `/google-calendar/calendars/primary`
 *   and `/google-calendar/calendars/primary/events` (a class on now, one
 *   starting in two minutes, more over the week).
 * - Resend: POST /resend/emails (the base for RESEND_TEST_ENDPOINT).
 * - AssemblyAI: GET /assemblyai/transcript/<id> returns a finished job (see
 *   scripts/dev/redirect-assemblyai.mjs).
 * - GET /_log returns everything received.
 *
 * Usage:
 *   STRIPE_WEBHOOK_SECRET=whsec_dev MOCK_APP_URL=http://localhost:3105 node scripts/dev/mock-phase5-services.mjs [port]   (default 7075)
 * then run the app with
 *   STRIPE_SECRET_KEY=sk_test_dev STRIPE_WEBHOOK_SECRET=whsec_dev STRIPE_PRICE_BASIC=price_basic \
 *   STRIPE_PRICE_PRO=price_pro STRIPE_PRICE_MAX=price_max STRIPE_API_BASE=http://127.0.0.1:7075/stripe/v1 \
 *   OPENAI_API_KEY=dev OPENAI_BASE_URL=http://127.0.0.1:7075/v1 \
 *   GOOGLE_CLIENT_ID=dev GOOGLE_CLIENT_SECRET=dev INTEGRATIONS_TEST_BASE_URL=http://127.0.0.1:7075 \
 *   RESEND_API_KEY=dev RESEND_FROM_EMAIL=dev@example.com RESEND_TEST_ENDPOINT=http://127.0.0.1:7075/resend/emails \
 *   npm run dev
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 7075);
const appUrl = (process.env.MOCK_APP_URL || "http://localhost:3105").replace(/\/$/, "");
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dev";
const base = `http://127.0.0.1:${port}`;
const PRICES = { price_basic: { plan: "Basic", amount: 500 }, price_pro: { plan: "Pro", amount: 2000 }, price_max: { plan: "Max", amount: 5000 } };

const state = { customers: new Map(), sessions: new Map(), subscriptions: new Map(), events: [], emails: [], chats: 0, calendar: [], webhookResults: [] };
const log = (...parts) => console.log("[mock-phase5]", ...parts);
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const html = (res, body) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;margin:40px auto;max-width:520px;padding:0 16px;color:#111}button{font:inherit;padding:10px 16px;margin:6px 6px 0 0;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer}.pay{background:#635bff;color:#fff;border-color:#635bff}small{color:#555}</style>${body}`);
};
const now = () => Math.floor(Date.now() / 1000);

/** Stripe's form encoding back into an object: a[b][0][c]=v. */
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
    cancel_at_period_end: sub.cancelAtPeriodEnd,
    metadata: sub.metadata,
    // Newer API versions put the period on the item; this mock does the same.
    items: { data: [{ price: { id: sub.price }, current_period_start: sub.periodStart, current_period_end: sub.periodEnd }] },
  };
}

async function sendEvent(type, object, created = now()) {
  const event = { id: `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`, object: "event", type, created, data: { object } };
  state.events.push(event);
  return deliver(event);
}

async function deliver(event) {
  const payload = JSON.stringify(event);
  const t = now();
  const signature = createHmac("sha256", webhookSecret).update(`${t}.${payload}`).digest("hex");
  try {
    const response = await fetch(`${appUrl}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${signature}` }, body: payload });
    const text = await response.text();
    state.webhookResults.push({ id: event.id, type: event.type, status: response.status, body: text.slice(0, 200) });
    log("webhook", event.type, event.id, "->", response.status, text.slice(0, 120));
    return { status: response.status, body: text };
  } catch (error) {
    log("webhook delivery failed", event.type, error.message);
    return { status: 0, body: error.message };
  }
}

function calendarEvents() {
  const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  const day = (days, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const dateOnly = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return [
    { id: "evt-bio-now", status: "confirmed", summary: "Biology 101: Cellular respiration", location: "Science Hall 204", start: { dateTime: at(-20) }, end: { dateTime: at(55) } },
    { id: "evt-chem-soon", status: "confirmed", summary: "Chemistry 210 seminar", start: { dateTime: at(2) }, end: { dateTime: at(62) }, hangoutLink: "https://meet.google.com/abc-defg-hij" },
    { id: "evt-hist", status: "confirmed", summary: "History of Science", location: "Room 12", start: { dateTime: day(1, 10) }, end: { dateTime: day(1, 11) } },
    { id: "evt-study", status: "confirmed", summary: "Study group", start: { dateTime: day(2, 16) }, end: { dateTime: day(2, 17) } },
    { id: "evt-reading", status: "confirmed", summary: "Reading week", start: { date: dateOnly(3) }, end: { date: dateOnly(4) } },
    { id: "evt-declined", status: "confirmed", summary: "Optional talk", start: { dateTime: day(3, 12) }, end: { dateTime: day(3, 13) }, attendees: [{ self: true, responseStatus: "declined" }] },
    { id: "evt-calc", status: "confirmed", summary: "Calculus II", location: "Math 101", start: { dateTime: day(4, 9) }, end: { dateTime: day(4, 10) } },
    { id: "evt-cancel", status: "cancelled", summary: "Cancelled lab" , start: { dateTime: day(5, 9) }, end: { dateTime: day(5, 10) } },
    { id: "evt-lab", status: "confirmed", summary: "Physics lab", start: { dateTime: day(5, 14) }, end: { dateTime: day(5, 16) } },
  ];
}

function chatReply(payload) {
  const system = payload.messages?.find((m) => m.role === "system")?.content ?? "";
  const user = [...(payload.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
  const schema = payload.response_format?.json_schema?.name;
  if (schema === "translated_lines") {
    const lines = JSON.parse(user).lines.map((line) => `[es] ${line}`);
    return JSON.stringify({ lines });
  }
  if (/^Translate/.test(system)) {
    return String(user).split("\n").map((line) => (line.trim() ? `${line} [es]` : line)).join("\n");
  }
  if (payload.response_format?.type === "json_object" || schema) {
    return JSON.stringify({ flashcards: [{ question: "What does ATP stand for?", answer: "Adenosine triphosphate", difficulty: "easy" }], terms: ["ATP"], items: [], chapters: [] });
  }
  return "## Summary\n\n- Cells make ATP in the mitochondria.\n- Plants also capture light in chloroplasts.\n";
}

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, base);
  const path = url.pathname;

  if (path === "/_log") return json(res, 200, { customers: [...state.customers.values()], subscriptions: [...state.subscriptions.values()], events: state.events.map((e) => ({ id: e.id, type: e.type })), webhookResults: state.webhookResults, emails: state.emails, chats: state.chats, calendar: state.calendar });

  // ------------------------------------------------------------ Stripe API
  if (path.startsWith("/stripe/v1/")) {
    const route = path.slice("/stripe/v1".length);
    if (req.headers.authorization !== "Bearer sk_test_dev") return json(res, 401, { error: { message: "Invalid API Key provided" } });
    const form = parseForm(body);
    if (req.method === "POST" && route === "/customers") {
      const id = `cus_mock_${state.customers.size + 1}`;
      state.customers.set(id, { id, email: form.email, name: form.name, metadata: form.metadata, idempotencyKey: req.headers["idempotency-key"] });
      return json(res, 200, { id, object: "customer" });
    }
    if (req.method === "DELETE" && route.startsWith("/customers/")) {
      const id = route.split("/")[2];
      state.customers.delete(id);
      return json(res, 200, { id, deleted: true });
    }
    if (req.method === "POST" && route === "/checkout/sessions") {
      const id = `cs_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      state.sessions.set(id, { id, ...form });
      log("checkout session", id, "promotion codes:", form.allow_promotion_codes, "automatic tax:", form.automatic_tax?.enabled);
      return json(res, 200, { id, object: "checkout.session", url: `${base}/stripe-checkout/${id}` });
    }
    if (req.method === "GET" && route.startsWith("/subscriptions/")) {
      const sub = state.subscriptions.get(route.split("/")[2]);
      return sub ? json(res, 200, subscriptionObject(sub)) : json(res, 404, { error: { message: "No such subscription" } });
    }
    if (req.method === "DELETE" && route.startsWith("/subscriptions/")) {
      const sub = state.subscriptions.get(route.split("/")[2]);
      if (!sub) return json(res, 404, { error: { message: "No such subscription" } });
      sub.status = "canceled";
      await sendEvent("customer.subscription.deleted", subscriptionObject(sub));
      return json(res, 200, subscriptionObject(sub));
    }
    if (req.method === "POST" && route === "/billing_portal/sessions") {
      const portal = new URL(`${base}/stripe-portal/${form.customer}`);
      portal.searchParams.set("return_url", form.return_url);
      if (form.flow_data?.type === "subscription_cancel") {
        portal.searchParams.set("flow", "cancel");
        portal.searchParams.set("after", form.flow_data.after_completion?.redirect?.return_url ?? form.return_url);
      }
      return json(res, 200, { id: `bps_${randomUUID().slice(0, 8)}`, url: portal.toString() });
    }
    return json(res, 404, { error: { message: `mock Stripe has no ${req.method} ${route}` } });
  }

  // ------------------------------------------------------------ hosted Checkout
  const checkoutMatch = path.match(/^\/stripe-checkout\/([^/]+)(\/pay)?$/);
  if (checkoutMatch) {
    const session = state.sessions.get(checkoutMatch[1]);
    if (!session) return json(res, 404, { error: "no session" });
    const price = PRICES[session.line_items?.[0]?.price] ?? { plan: "?", amount: 0 };
    if (!checkoutMatch[2]) {
      return html(res, `<h1>Mock Stripe Checkout</h1><p>StudyScribe ${price.plan}: <strong>$${(price.amount / 100).toFixed(2)}</strong> per month</p><p><small>${session.custom_text?.submit?.message ?? ""}</small></p><p><small>Promotion codes ${session.allow_promotion_codes === "true" ? "allowed" : "off"} · Automatic tax ${session.automatic_tax?.enabled === "true" ? "on" : "off"}</small></p><form method="post" action="/stripe-checkout/${session.id}/pay"><button class="pay">Subscribe</button></form><p><a href="${session.cancel_url}">Back</a></p>`);
    }
    const subId = `sub_mock_${state.subscriptions.size + 1}`;
    const periodStart = now();
    const sub = { id: subId, customer: session.customer, status: "active", price: session.line_items[0].price, cancelAtPeriodEnd: false, periodStart, periodEnd: periodStart + 30 * 86400, metadata: session.subscription_data?.metadata ?? {} };
    state.subscriptions.set(subId, sub);
    // Stripe sends these in no guaranteed order; the app must cope either way.
    await sendEvent("customer.subscription.created", subscriptionObject(sub));
    await sendEvent("checkout.session.completed", { id: session.id, object: "checkout.session", mode: "subscription", customer: session.customer, subscription: subId, client_reference_id: session.client_reference_id, metadata: session.metadata });
    res.writeHead(303, { location: session.success_url });
    return res.end();
  }

  // ------------------------------------------------------------ hosted portal
  const portalMatch = path.match(/^\/stripe-portal\/([^/]+)(\/(switch|cancel|resume))?$/);
  if (portalMatch) {
    const customer = portalMatch[1];
    const sub = [...state.subscriptions.values()].reverse().find((candidate) => candidate.customer === customer && candidate.status !== "canceled");
    const returnUrl = url.searchParams.get("return_url") ?? appUrl;
    if (!portalMatch[2]) {
      if (!sub) return html(res, `<h1>Mock billing portal</h1><p>No active subscription.</p><p><a href="${returnUrl}">Return to StudyScribe</a></p>`);
      const after = url.searchParams.get("after") ?? returnUrl;
      const q = (extra) => `?return_url=${encodeURIComponent(returnUrl)}&after=${encodeURIComponent(after)}${extra}`;
      const isCancelFlow = url.searchParams.get("flow") === "cancel";
      return html(
        res,
        `<h1>Mock billing portal</h1><p>Current: ${PRICES[sub.price]?.plan} (${sub.status}${sub.cancelAtPeriodEnd ? ", cancels at period end" : ""})</p>` +
          (isCancelFlow
            ? `<h2>Cancel your plan?</h2><form method="post" action="/stripe-portal/${customer}/cancel${q("")}"><button class="pay">Cancel plan</button></form>`
            : `<form method="post" action="/stripe-portal/${customer}/switch${q("&price=price_max")}"><button>Switch to Max</button></form><form method="post" action="/stripe-portal/${customer}/switch${q("&price=price_basic")}"><button>Switch to Basic</button></form><form method="post" action="/stripe-portal/${customer}/cancel${q("")}"><button>Cancel plan</button></form>`) +
          `<p><a href="${returnUrl}">Return to StudyScribe</a></p>`,
      );
    }
    if (!sub) return json(res, 404, { error: "no subscription" });
    if (portalMatch[3] === "switch") sub.price = url.searchParams.get("price");
    if (portalMatch[3] === "cancel") sub.cancelAtPeriodEnd = true;
    if (portalMatch[3] === "resume") sub.cancelAtPeriodEnd = false;
    await sendEvent("customer.subscription.updated", subscriptionObject(sub));
    res.writeHead(303, { location: portalMatch[3] === "cancel" ? url.searchParams.get("after") ?? returnUrl : returnUrl });
    return res.end();
  }

  // ------------------------------------------------------------ test controls
  if (req.method === "POST" && path === "/_stripe/payment-failed") {
    const customer = url.searchParams.get("customer");
    return json(res, 200, await sendEvent("invoice.payment_failed", { id: `in_${randomUUID().slice(0, 8)}`, object: "invoice", customer, subscription: [...state.subscriptions.values()].find((sub) => sub.customer === customer)?.id ?? null }));
  }
  if (req.method === "POST" && path === "/_stripe/replay") {
    const last = state.events[state.events.length - 1];
    return last ? json(res, 200, await deliver(last)) : json(res, 404, { error: "no events yet" });
  }
  if (req.method === "POST" && path === "/_stripe/stale") {
    // An old "canceled" update for the newest subscription, created an hour ago.
    const sub = [...state.subscriptions.values()].pop();
    if (!sub) return json(res, 404, { error: "no subscription" });
    return json(res, 200, await sendEvent("customer.subscription.updated", { ...subscriptionObject(sub), status: "canceled" }, now() - 3600));
  }
  if (req.method === "POST" && path === "/_stripe/end-period") {
    const sub = [...state.subscriptions.values()].reverse().find((candidate) => candidate.status !== "canceled");
    if (!sub) return json(res, 404, { error: "no subscription" });
    sub.status = "canceled";
    return json(res, 200, await sendEvent("customer.subscription.deleted", subscriptionObject(sub)));
  }

  // ------------------------------------------------------------ OpenAI-compatible
  if (path === "/v1/chat/completions") {
    state.chats += 1;
    const payload = JSON.parse(body || "{}");
    await new Promise((resolve) => setTimeout(resolve, 400));
    return json(res, 200, { id: `chat-${state.chats}`, object: "chat.completion", created: now(), model: payload.model ?? "mock", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: chatReply(payload) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }

  // ------------------------------------------------------------ Google OAuth + Calendar
  if (path === "/google-authorize") {
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", `code-${randomUUID().slice(0, 8)}`);
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    state.calendar.push({ step: "authorize", scope: url.searchParams.get("scope") });
    res.writeHead(302, { location: redirect.toString() });
    return res.end();
  }
  if (path === "/google-token") {
    const form = new URLSearchParams(body);
    state.calendar.push({ step: "token", grant: form.get("grant_type") });
    return json(res, 200, { access_token: "ya29.mock-calendar", expires_in: 3599, refresh_token: form.get("grant_type") === "authorization_code" ? "1//mock-refresh" : undefined, scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.file", token_type: "Bearer" });
  }
  if (path === "/google-revoke") {
    state.calendar.push({ step: "revoke" });
    res.writeHead(200);
    return res.end();
  }
  if (path.startsWith("/google-calendar/")) {
    if (req.headers.authorization !== "Bearer ya29.mock-calendar") return json(res, 401, { error: { message: "unauthorized" } });
    if (path === "/google-calendar/calendars/primary") return json(res, 200, { id: "student@example.com", summary: "student@example.com" });
    if (path === "/google-calendar/calendars/primary/events") {
      state.calendar.push({ step: "events", timeMin: url.searchParams.get("timeMin"), timeMax: url.searchParams.get("timeMax") });
      const min = Date.parse(url.searchParams.get("timeMin") ?? "1970-01-01");
      const max = Date.parse(url.searchParams.get("timeMax") ?? "2999-01-01");
      const items = calendarEvents().filter((event) => {
        const start = Date.parse(event.start.dateTime ?? `${event.start.date}T00:00:00`);
        const end = Date.parse(event.end?.dateTime ?? `${event.end?.date ?? event.start.date}T00:00:00`);
        return end > min && start < max;
      });
      return json(res, 200, { items });
    }
  }

  // ------------------------------------------------------------ Resend
  if (path === "/resend/emails") {
    const payload = JSON.parse(body || "{}");
    const link = payload.html?.match(/href="([^"]*verify-email[^"]*)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;
    state.emails.push({ to: payload.to, subject: payload.subject, link });
    log("email", payload.subject, "to", payload.to?.join(", "));
    return json(res, 200, { id: randomUUID() });
  }

  // ------------------------------------------------------------ AssemblyAI
  if (path.startsWith("/assemblyai/transcript/")) {
    const lines = ["Today we look at how cells make energy.", "Mitochondria produce adenosine triphosphate, the molecule cells spend to do work.", "Is that the same in plant cells?", "Plants also have chloroplasts, where photosynthesis captures light."];
    const utterances = lines.map((text, i) => ({ speaker: i === 2 ? "B" : "A", start: i * 15_000, end: i * 15_000 + 12_000, text, confidence: 0.95 }));
    return json(res, 200, { id: path.split("/").pop(), status: "completed", text: lines.join(" "), language_code: "en", utterances });
  }

  json(res, 404, { error: `mock has no ${req.method} ${path}` });
});

server.listen(port, "127.0.0.1", () => log(`listening on ${base}; webhooks go to ${appUrl}/api/stripe/webhook`));
