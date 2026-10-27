import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const getRecordingByAudioKey = vi.fn();
const getRecordingAccess = vi.fn(async () => null);
const getSessionFromCookie = vi.fn();

vi.mock("../db", () => ({
  getRecordingByAudioKey: (...args: unknown[]) => getRecordingByAudioKey(...args),
}));

vi.mock("../recordingAccess", () => ({
  getRecordingAccess: (...args: unknown[]) => getRecordingAccess(...args),
}));

vi.mock("../sessionUser", () => ({
  getVerifiedSession: async (...args: unknown[]) => getSessionFromCookie(...args),
}));

vi.mock("../storage", () => ({
  createDirectAudioUpload: vi.fn(),
  isVercelBlobStorageConfigured: () => true,
  isObjectStorageConfigured: () => true,
  contentTypeFromStorageKey: (key: string) => (key.endsWith("-webm.bin") ? "audio/webm" : "application/octet-stream"),
  storageGetSignedUrl: async () => SIGNED_URL,
}));

const softCapReached = vi.fn(async () => false);
const limitReached = vi.fn(async () => false);
vi.mock("../blobTransfer", () => ({
  recordTransfer: vi.fn(),
  isTransferSoftCapReached: () => softCapReached(),
  isTransferLimitReached: () => limitReached(),
  TRANSFER_PAUSED_MESSAGE: "paused",
}));

import { registerStorageProxy, fullBodyCache, rangeSupport } from "./storageProxy";

const SIGNED_URL = "https://blob.example/signed-get-url";
const KEY = "7/recordings/abc-webm.bin";

const realFetch = globalThis.fetch;
let upstream: (init?: RequestInit) => Response;

beforeEach(() => {
  fullBodyCache.clear();
  rangeSupport.clear();
  softCapReached.mockResolvedValue(false);
  limitReached.mockResolvedValue(false);
  getRecordingByAudioKey.mockResolvedValue({ id: 1, userId: 7, publicShareToken: "tok_public" });
  getRecordingAccess.mockResolvedValue(null);
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
    getRecordingAccess.mockResolvedValue({ role: "view" } as any);
    const response = await request(url);
    expect(response.status).toBe(200);
  });

  it("refuses a signed-in user with no share", async () => {
    getSessionFromCookie.mockReturnValue({ userId: 99 });
    getRecordingAccess.mockResolvedValue(null);
    const response = await request(url);
    expect(response.status).toBe(403);
  });

  it("answers the range itself when storage ignores the header, rather than replying 200 to a ranged request", async () => {
    // Safari treats a 200 answer to a ranged media request as non-seekable and
    // can refuse the source outright, so this case must still yield a 206.
    upstream = () =>
      new Response("0123456789", { status: 200, headers: { "content-length": "10" } });

    const response = await request(url, { Range: "bytes=2-5" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });

  it("supports an open-ended range when storage ignores the header", async () => {
    upstream = () => new Response("0123456789", { status: 200, headers: { "content-length": "10" } });
    const response = await request(url, { Range: "bytes=7-" });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("789");
  });

  it("supports a suffix range asking for the final bytes", async () => {
    upstream = () => new Response("0123456789", { status: 200, headers: { "content-length": "10" } });
    const response = await request(url, { Range: "bytes=-3" });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("789");
  });

  it("returns 416 for a range that starts past the end of the file", async () => {
    upstream = () => new Response("0123456789", { status: 200, headers: { "content-length": "10" } });
    const response = await request(url, { Range: "bytes=50-60" });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });
});

describe("audio access rules (Phase 6 review)", () => {
  it("accepts the public link's token without a session", async () => {
    getSessionFromCookie.mockReturnValue(null);
    const response = await request(`${url}&token=tok_public`);
    expect(response.status).toBe(200);
  });

  it("refuses a wrong token and a trashed recording's token", async () => {
    getSessionFromCookie.mockReturnValue(null);
    expect((await request(`${url}&token=tok_wrong`)).status).toBe(401);
    getRecordingByAudioKey.mockResolvedValue({ id: 1, userId: 7, publicShareToken: "tok_public", isDeleted: 1 });
    expect((await request(`${url}&token=tok_public`)).status).toBe(401);
  });

  it("no longer serves legacy storage keys to anyone who knows the key", async () => {
    const { ENV } = await import("./env");
    const saved = { url: ENV.forgeApiUrl, key: ENV.forgeApiKey };
    Object.assign(ENV, { forgeApiUrl: "https://forge.example", forgeApiKey: "forge-key" });
    try {
      getSessionFromCookie.mockReturnValue(null);
      expect((await request(`/manus-storage/${KEY}`)).status).toBe(401);
      getSessionFromCookie.mockReturnValue({ userId: 99 });
      expect((await request(`/manus-storage/${KEY}`)).status).toBe(403);
      getRecordingByAudioKey.mockResolvedValue(null);
      expect((await request(`/manus-storage/9/recordings/unknown.webm`)).status).toBe(404);
    } finally {
      Object.assign(ENV, { forgeApiUrl: saved.url, forgeApiKey: saved.key });
    }
  });
});

describe("bandwidth savings", () => {
  it("lets browsers cache privately and answers If-None-Match with 304 without touching storage", async () => {
    const first = await request(url);
    expect(first.headers.get("cache-control")).toBe("private, max-age=600");
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    let fetched = 0;
    upstream = () => {
      fetched += 1;
      return new Response("x");
    };
    const second = await request(url, { "If-None-Match": etag });
    expect(second.status).toBe(304);
    expect(fetched).toBe(0);
  });

  it("still checks access before a 304", async () => {
    const etag = (await request(url)).headers.get("etag")!;
    getSessionFromCookie.mockReturnValue({ userId: 99 });
    expect((await request(url, { "If-None-Match": etag })).status).toBe(403);
  });

  it("downloads a file that ignores Range once, then serves later ranges from memory", async () => {
    let fetched = 0;
    upstream = () => {
      fetched += 1;
      return new Response("0123456789", { status: 200, headers: { "content-length": "10" } });
    };
    expect(await (await request(url, { Range: "bytes=0-1" })).text()).toBe("01");
    expect(await (await request(url, { Range: "bytes=4-6" })).text()).toBe("456");
    expect((await request(url, { Range: "bytes=8-" })).status).toBe(206);
    expect(fetched).toBe(1);
  });

  it("does not serve the cached copy to someone without access", async () => {
    upstream = () => new Response("0123456789", { status: 200, headers: { "content-length": "10" } });
    await request(url, { Range: "bytes=0-1" });
    getSessionFromCookie.mockReturnValue({ userId: 99 });
    expect((await request(url, { Range: "bytes=0-1" })).status).toBe(403);
  });

  it("keeps passing Range upstream when storage honors it", async () => {
    let calls = 0;
    upstream = () => {
      calls += 1;
      return new Response("a", { status: 206, headers: { "content-range": "bytes 0-0/11", "content-length": "1" } });
    };
    await request(url, { Range: "bytes=0-0" });
    await request(url, { Range: "bytes=0-0" });
    expect(calls).toBe(2);
  });
});

describe("transfer soft cap", () => {
  it("refuses a share recipient and a public link but keeps the owner playing", async () => {
    softCapReached.mockResolvedValue(true);
    expect((await request(url)).status).toBe(200);
    getSessionFromCookie.mockReturnValue({ userId: 99 });
    getRecordingAccess.mockResolvedValue({ role: "view" } as any);
    expect((await request(url)).status).toBe(503);
    getSessionFromCookie.mockReturnValue(null);
    expect((await request(`${url}&token=tok_public`)).status).toBe(503);
  });

  it("stops even the owner at the hard limit", async () => {
    limitReached.mockResolvedValue(true);
    expect((await request(url)).status).toBe(503);
  });
});

describe("range edge cases", () => {
  it("streams only the requested slice of a file too large to buffer when storage ignores Range", async () => {
    upstream = () => new Response("0123456789", { status: 200, headers: { "content-length": String(40 * 1024 * 1024) } });
    const response = await request(url, { Range: "bytes=2-5" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 2-5/${40 * 1024 * 1024}`);
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("ignores Range when If-Range does not match the current validator, and honors it when it does", async () => {
    upstream = (init) =>
      new Headers(init?.headers).get("range")
        ? new Response("a", { status: 206, headers: { "content-range": "bytes 0-0/11", "content-length": "1" } })
        : new Response("audio-bytes", { status: 200, headers: { "content-length": "11" } });
    const etag = (await request(url)).headers.get("etag")!;
    const stale = await request(url, { Range: "bytes=0-0", "If-Range": '"stale"' });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe("audio-bytes");
    const fresh = await request(url, { Range: "bytes=0-0", "If-Range": etag });
    expect(fresh.status).toBe(206);
  });
});
