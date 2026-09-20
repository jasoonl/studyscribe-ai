import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const getRecordingByAudioKey = vi.fn();
const getRecordingShareForUser = vi.fn(async () => null);
const getSessionFromCookie = vi.fn();

vi.mock("../db", () => ({
  getRecordingByAudioKey: (...args: unknown[]) => getRecordingByAudioKey(...args),
  getRecordingShareForUser: (...args: unknown[]) => getRecordingShareForUser(...args),
}));

vi.mock("../sessionManager", () => ({
  getSessionFromCookie: (...args: unknown[]) => getSessionFromCookie(...args),
}));

vi.mock("../storage", () => ({
  createDirectAudioUpload: vi.fn(),
  isVercelBlobStorageConfigured: () => true,
  contentTypeFromStorageKey: (key: string) => (key.endsWith("-webm.bin") ? "audio/webm" : "application/octet-stream"),
  storageGetSignedUrl: async () => SIGNED_URL,
}));

import { registerStorageProxy } from "./storageProxy";

const SIGNED_URL = "https://blob.example/signed-get-url";
const KEY = "7/recordings/abc-webm.bin";

const realFetch = globalThis.fetch;
let upstream: (init?: RequestInit) => Response;

beforeEach(() => {
  getRecordingByAudioKey.mockResolvedValue({ id: 1, userId: 7, publicShareToken: "tok_public" });
  getRecordingShareForUser.mockResolvedValue(null);
  getSessionFromCookie.mockReturnValue({ userId: 7 });
  upstream = () => new Response("audio-bytes", { status: 200, headers: { "content-length": "11" } });

  // Only the blob read is faked; requests to the test server itself must go
  // through the real implementation.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith(SIGNED_URL)) return Promise.resolve(upstream(init));
    return realFetch(input as never, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function request(path: string, headers?: Record<string, string>) {
  const app = express();
  registerStorageProxy(app);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  try {
    return await realFetch(`http://127.0.0.1:${address.port}${path}`, { headers });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

const url = `/api/storage?key=${encodeURIComponent(KEY)}`;

describe("audio playback proxy", () => {
  it("advertises byte-range support, which Safari requires before it will play anything", async () => {
    const response = await request(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("audio/webm");
  });

  it("passes a client Range header upstream and relays the 206 with Content-Range", async () => {
    let forwardedRange: string | undefined;
    upstream = (init) => {
      forwardedRange = new Headers(init?.headers).get("range") ?? undefined;
      return new Response("a", {
        status: 206,
        headers: { "content-range": "bytes 0-0/11", "content-length": "1" },
      });
    };

    const response = await request(url, { Range: "bytes=0-0" });
    expect(forwardedRange).toBe("bytes=0-0");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-0/11");
  });

  it("serves the real audio content type rather than the generic type the bytes are stored under", async () => {
    const response = await request(url);
    expect(response.headers.get("content-type")).toBe("audio/webm");
    expect(await response.text()).toBe("audio-bytes");
  });

  it("reports a storage failure as 502 instead of pretending the file is unplayable", async () => {
    upstream = () => new Response("denied", { status: 403 });
    const response = await request(url);
    expect(response.status).toBe(502);
  });

  it("refuses an anonymous request for a recording with no public link", async () => {
    getSessionFromCookie.mockReturnValue(null);
    getRecordingByAudioKey.mockResolvedValue({ id: 1, userId: 7, publicShareToken: null });
    const response = await request(url);
    expect(response.status).toBe(401);
  });

  it("lets a public share link play the audio with no session at all", async () => {
    getSessionFromCookie.mockReturnValue(null);
    const response = await request(`${url}&token=tok_public`);
    expect(response.status).toBe(200);
  });

  it("rejects a wrong public share token", async () => {
    getSessionFromCookie.mockReturnValue(null);
    const response = await request(`${url}&token=not-the-token`);
    expect(response.status).toBe(401);
  });

  it("lets a signed-in share recipient play a recording they do not own", async () => {
    getSessionFromCookie.mockReturnValue({ userId: 99 });
    getRecordingShareForUser.mockResolvedValue({ id: 5 });
    const response = await request(url);
    expect(response.status).toBe(200);
  });

  it("refuses a signed-in user with no share", async () => {
    getSessionFromCookie.mockReturnValue({ userId: 99 });
    getRecordingShareForUser.mockResolvedValue(null);
    const response = await request(url);
    expect(response.status).toBe(403);
  });
});
