import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import * as relay from "../scripts/youtube-relay/relay.mjs";
import { sign, signedHeaders, verifySignature } from "./youtubeRelay";

const KEY = "k".repeat(43);
const body = Buffer.from(JSON.stringify({ method: "PING" }));

describe("relay request signatures", () => {
  it("accepts a request signed by the server client", () => {
    const headers = signedHeaders(KEY, "relay-request", body);
    expect(relay.verifyRequest(KEY, headers, body, relay.createNonceCache())).toBe(true);
  });

  it("rejects a missing, wrong-key, tampered, stale or replayed request", () => {
    const nonces = relay.createNonceCache();
    const headers = signedHeaders(KEY, "relay-request", body);
    expect(relay.verifyRequest(KEY, {}, body, nonces)).toBe(false);
    expect(relay.verifyRequest("x".repeat(43), headers, body, nonces)).toBe(false);
    expect(relay.verifyRequest(KEY, headers, Buffer.from('{"method":"GET"}'), nonces)).toBe(false);
    expect(relay.verifyRequest(KEY, { ...signedHeaders(KEY, "relay-register", body) }, body, nonces)).toBe(false);
    const ts = Date.now() - 5 * 60_000;
    const nonce = "a".repeat(32);
    expect(relay.verifyRequest(KEY, { "x-relay-ts": String(ts), "x-relay-nonce": nonce, "x-relay-sig": sign(KEY, "relay-request", ts, nonce, body) }, body, nonces)).toBe(false);
    expect(relay.verifyRequest(KEY, headers, body, nonces)).toBe(true);
    expect(relay.verifyRequest(KEY, headers, body, nonces)).toBe(false);
  });
});

describe("relay response signatures", () => {
  it("verifies a genuine reply and rejects a tampered one", () => {
    const purpose = `relay-response\n${"b".repeat(32)}\n200`;
    const payload = Buffer.from("audio bytes");
    const ts = Date.now();
    const nonce = "c".repeat(32);
    const headers: Record<string, string> = { "x-relay-ts": String(ts), "x-relay-nonce": nonce, "x-relay-sig": relay.sign(KEY, purpose, ts, nonce, payload) };
    expect(verifySignature(KEY, purpose, (n) => headers[n], payload)).toBe(nonce);
    expect(verifySignature(KEY, purpose, (n) => headers[n], Buffer.from("fake audio!"))).toBeNull();
    expect(verifySignature(KEY, purpose.replace("200", "206"), (n) => headers[n], payload)).toBeNull();
  });
});

describe("relay destination allowlist", () => {
  it.each([
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    "https://rr3---sn-abc123.googlevideo.com/videoplayback?id=1&range=0-10",
  ])("allows %s", (url) => expect(relay.isAllowedTarget(url)).toBe(true));

  it.each([
    "http://www.youtube.com/youtubei/v1/player",
    "https://www.youtube.com/watch?v=abc",
    "https://evil.com/videoplayback",
    "https://googlevideo.com.evil.com/videoplayback",
    "https://user:pw@rr1.googlevideo.com/videoplayback",
    "https://rr1.googlevideo.com:8443/videoplayback",
    "https://rr1.googlevideo.com/other",
    "https://127.0.0.1/videoplayback",
    "file:///etc/passwd",
    "not a url",
  ])("refuses %s", (url) => expect(relay.isAllowedTarget(url)).toBe(false));

  it("only follows redirects to googlevideo", () => {
    expect(relay.isAllowedTarget("https://www.youtube.com/youtubei/v1/player", { redirect: true })).toBe(false);
    expect(relay.isAllowedTarget("https://rr1.googlevideo.com/videoplayback", { redirect: true })).toBe(true);
  });

  it("treats private and special addresses as blocked", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.1.1", "nonsense"]) {
      expect(relay.isPublicAddress(address)).toBe(false);
    }
    expect(relay.isPublicAddress("142.250.72.14")).toBe(true);
    expect(relay.isPublicAddress("2607:f8b0:4005:80a::200e")).toBe(true);
  });
});
