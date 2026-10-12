import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  buildEnvelope,
  nextRetryDelay,
  parseEvents,
  payloadText,
  postSigned,
  privateTargetsAllowed,
  resolveWebhookTarget,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./outgoingWebhooks";

describe("webhook signing", () => {
  const body = JSON.stringify({ event: "transcript.ready" });

  it("signs <timestamp>.<body> with HMAC-SHA256 and verifies it", () => {
    const header = signWebhookPayload("whsec_test", body, 1_700_000_000);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature("whsec_test", body, header, { nowSeconds: 1_700_000_010 })).toBe(true);
  });

  it("rejects a changed body, a wrong secret and an old timestamp", () => {
    const header = signWebhookPayload("whsec_test", body, 1_700_000_000);
    expect(verifyWebhookSignature("whsec_test", `${body} `, header, { nowSeconds: 1_700_000_000 })).toBe(false);
    expect(verifyWebhookSignature("whsec_other", body, header, { nowSeconds: 1_700_000_000 })).toBe(false);
    expect(verifyWebhookSignature("whsec_test", body, header, { nowSeconds: 1_700_000_000 + 3600 })).toBe(false);
    expect(verifyWebhookSignature("whsec_test", body, "garbage", { nowSeconds: 1_700_000_000 })).toBe(false);
  });

  it("wraps data in an envelope with id, event and time", () => {
    const envelope = JSON.parse(buildEnvelope("notes.generated", { a: 1 }, "dlv_1", new Date("2026-10-12T00:00:00Z")));
    expect(envelope).toEqual({ id: "dlv_1", event: "notes.generated", createdAt: "2026-10-12T00:00:00.000Z", data: { a: 1 } });
  });

  it("truncates very long transcripts in payloads", () => {
    expect(payloadText("short")).toEqual({ text: "short", truncated: false });
    const long = payloadText("x".repeat(150_000));
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBe(100_000);
  });

  it("parses stored event lists, dropping unknown names", () => {
    expect(parseEvents("recording.completed, transcript.ready,bogus")).toEqual(["recording.completed", "transcript.ready"]);
  });
});

describe("retry backoff", () => {
  it("backs off after each failure and gives up after the last attempt", () => {
    expect(nextRetryDelay(1)).toBe(RETRY_DELAYS_MS[0]);
    expect(nextRetryDelay(2)).toBe(RETRY_DELAYS_MS[1]);
    expect(nextRetryDelay(5)).toBe(RETRY_DELAYS_MS[4]);
    expect(nextRetryDelay(MAX_ATTEMPTS)).toBeNull();
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) expect(RETRY_DELAYS_MS[i]).toBeGreaterThan(RETRY_DELAYS_MS[i - 1]);
  });
});

describe("SSRF guard", () => {
  const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

  it("accepts a public https URL and pins the resolved address", async () => {
    const target = await resolveWebhookTarget("https://hooks.example.com/in", { allowPrivate: false, resolve: publicDns });
    expect(target.address).toBe("93.184.216.34");
    expect(target.url.hostname).toBe("hooks.example.com");
  });

  it.each([
    "http://127.0.0.1/hook",
    "http://10.0.0.5/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/hook",
    "http://[::ffff:127.0.0.1]/hook",
    "http://localhost:3000/hook",
    "https://printer.local/hook",
  ])("refuses private target %s", async url => {
    await expect(resolveWebhookTarget(url, { allowPrivate: false, resolve: publicDns })).rejects.toThrow(/public address/);
  });

  it("refuses a hostname that resolves to any private address (DNS rebinding)", async () => {
    const mixed = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ];
    await expect(resolveWebhookTarget("https://sneaky.example.com", { allowPrivate: false, resolve: mixed })).rejects.toThrow(/public address/);
  });

  it("refuses other schemes and credentials in the URL", async () => {
    await expect(resolveWebhookTarget("ftp://example.com/x", { allowPrivate: false, resolve: publicDns })).rejects.toThrow(/https/);
    await expect(resolveWebhookTarget("https://user:pass@example.com/x", { allowPrivate: false, resolve: publicDns })).rejects.toThrow(/credentials/);
    await expect(resolveWebhookTarget("not a url", { allowPrivate: false, resolve: publicDns })).rejects.toThrow(/valid URL/);
  });

  it("only allows private targets outside production, when explicitly enabled", () => {
    expect(privateTargetsAllowed({ NODE_ENV: "development", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "true" } as any)).toBe(true);
    expect(privateTargetsAllowed({ NODE_ENV: "production", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "true" } as any)).toBe(false);
    expect(privateTargetsAllowed({ NODE_ENV: "development" } as any)).toBe(false);
  });
});

describe("postSigned", () => {
  let server: Server;
  let base: string;
  const received: Array<{ headers: IncomingMessage["headers"]; body: string; path: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body, path: req.url ?? "" });
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "http://169.254.169.254/" });
          res.end();
        } else if (req.url === "/fail") {
          res.writeHead(500);
          res.end("nope");
        } else if (req.url === "/slow") {
          setTimeout(() => res.end("late"), 2_000);
        } else {
          res.writeHead(204);
          res.end();
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it("delivers the signed body with event headers", async () => {
    const target = await resolveWebhookTarget(`${base}/ok`, { allowPrivate: true });
    const body = '{"hello":"world"}';
    const signature = signWebhookPayload("whsec_abc", body, Math.floor(Date.now() / 1000));
    const result = await postSigned(target, body, { "StudyScribe-Signature": signature, "StudyScribe-Event": "webhook.test" });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    const last = received[received.length - 1];
    expect(last.body).toBe(body);
    expect(last.headers["studyscribe-event"]).toBe("webhook.test");
    expect(verifyWebhookSignature("whsec_abc", last.body, String(last.headers["studyscribe-signature"]))).toBe(true);
  });

  it("never follows redirects", async () => {
    const target = await resolveWebhookTarget(`${base}/redirect`, { allowPrivate: true });
    const result = await postSigned(target, "{}", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.error).toMatch(/redirect/);
  });

  it("reports error statuses and timeouts without throwing", async () => {
    const failing = await postSigned(await resolveWebhookTarget(`${base}/fail`, { allowPrivate: true }), "{}", {});
    expect(failing).toMatchObject({ ok: false, status: 500 });
    const slow = await postSigned(await resolveWebhookTarget(`${base}/slow`, { allowPrivate: true }), "{}", {}, 300);
    expect(slow.ok).toBe(false);
    expect(slow.status).toBeNull();
    expect(slow.error).toMatch(/No answer|connect/);
  });

  it("connects to the pinned address even if the hostname would resolve elsewhere", async () => {
    const port = (server.address() as AddressInfo).port;
    const target = await resolveWebhookTarget(`http://receiver.test:${port}/ok`, { allowPrivate: true, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
    const result = await postSigned(target, "{}", {});
    expect(result.ok).toBe(true);
    expect(received[received.length - 1].headers.host).toBe(`receiver.test:${port}`);
  });
});
