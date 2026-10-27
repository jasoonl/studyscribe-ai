import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  issueSignedToken: vi.fn(async () => ({})),
  presignUrl: vi.fn(async () => ({ presignedUrl: "https://blob.example/put" })),
  head: vi.fn(async () => ({ size: 5, contentType: "application/octet-stream" })),
  del: vi.fn(async () => undefined),
  list: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: class extends Error {},
  issueSignedToken: blob.issueSignedToken,
  presignUrl: blob.presignUrl,
  head: blob.head,
  del: blob.del,
  list: blob.list,
  put: vi.fn(),
}));

import { StorageDeleteError, createDirectAudioUpload, createDirectSourceUpload, deleteStoredAudio, getBlobUsage, getStorageProvider, isR2StorageConfigured, isTransferMetered, issueLargeUploadToken, storageGet, storageGetSignedUrl, verifyUploadedAudio, verifyUploadedSource } from "./storage";
import { isTransferLimitReached, isTransferSoftCapReached, assertTransferHeadroomForImport, recordTransfer, getTransferReport } from "./blobTransfer";
import { r2Status } from "./systemHealth";

const R2_ENV = { R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "AKIAR2KEY", R2_SECRET_ACCESS_KEY: "r2-secret-xyz", R2_BUCKET: "bkt" };
const KEYS = [...Object.keys(R2_ENV), "R2_ENDPOINT", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN", "BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const useR2 = () => Object.assign(process.env, R2_ENV);

describe("provider precedence", () => {
  it("is none, then blob, then r2 when more is configured", () => {
    expect(getStorageProvider()).toBe("none");
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    expect(getStorageProvider()).toBe("blob");
    useR2();
    expect(getStorageProvider()).toBe("r2");
    expect(isR2StorageConfigured()).toBe(true);
  });

  it("an incomplete R2 set does not shadow Blob", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    Object.assign(process.env, { ...R2_ENV, R2_BUCKET: "" });
    expect(isR2StorageConfigured()).toBe(false);
    expect(getStorageProvider()).toBe("blob");
  });

  it("falls back to forge when only the legacy API is set", () => {
    process.env.BUILT_IN_FORGE_API_URL = "https://forge.example";
    process.env.BUILT_IN_FORGE_API_KEY = "k";
    expect(getStorageProvider()).toBe("forge");
  });
});

describe("R2 provider", () => {
  it("issues a single signed PUT for audio at any size and labels the provider", async () => {
    useR2();
    const upload = await createDirectAudioUpload({ userId: 7, fileName: "lecture.mp3", mimeType: "audio/mpeg", size: 900 * 1024 * 1024 });
    expect(upload?.provider).toBe("r2");
    expect(upload?.key).toMatch(/^7\/recordings\/[0-9a-f-]{36}-mp3\.bin$/);
    const url = new URL(upload!.uploadUrl);
    expect(url.host).toBe("acct.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/bkt/${upload!.key}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(blob.issueSignedToken).not.toHaveBeenCalled();
  });

  it("rejects unsupported types and sizes before signing", async () => {
    useR2();
    await expect(createDirectAudioUpload({ userId: 1, fileName: "a.txt", mimeType: "text/plain", size: 10 })).rejects.toThrow(/Unsupported/);
    await expect(createDirectAudioUpload({ userId: 1, fileName: "a.mp3", mimeType: "audio/mpeg", size: 0 })).rejects.toThrow();
  });

  it("signs source uploads and reports the provider", async () => {
    useR2();
    const upload = await createDirectSourceUpload({ userId: 3, fileName: "notes.pdf", size: 1000 });
    expect(upload?.provider).toBe("r2");
    expect(upload?.key).toMatch(/^3\/sources\/.+-pdf\.bin$/);
  });

  it("keeps using Blob when R2 is not configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    const upload = await createDirectAudioUpload({ userId: 1, fileName: "a.mp3", mimeType: "audio/mpeg", size: 100 });
    expect(upload?.provider).toBe("blob");
    expect(upload?.uploadUrl).toBe("https://blob.example/put");
  });

  it("returns null with no storage", async () => {
    expect(await createDirectAudioUpload({ userId: 1, fileName: "a.mp3", mimeType: "audio/mpeg", size: 100 })).toBeNull();
  });

  it("verifies uploads with a HEAD and explains a missing or empty object without leaking secrets", async () => {
    useR2();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": "99", "content-type": "application/octet-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyUploadedAudio("1/recordings/a.bin")).toEqual({ size: 99, contentType: "application/octet-stream" });
    expect(await verifyUploadedSource("1/sources/a.bin")).toEqual({ size: 99 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const missing = await verifyUploadedAudio("1/recordings/a.bin").catch((e: Error) => e);
    expect((missing as Error).message).toMatch(/could not be found/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const refused = await verifyUploadedSource("1/sources/a.bin").catch((e: Error) => e);
    for (const e of [missing, refused]) {
      expect((e as Error).message).not.toContain(R2_ENV.R2_SECRET_ACCESS_KEY);
      expect((e as Error).message).not.toContain(R2_ENV.R2_ACCESS_KEY_ID);
      expect((e as Error).message).not.toContain("X-Amz");
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": "0" } })));
    await expect(verifyUploadedAudio("k.bin")).rejects.toThrow(/empty/);
  });

  it("deletes each key with a DELETE and surfaces other failures", async () => {
    useR2();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteStoredAudio(["a.bin", "a.bin", "b.bin", ""]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ method: "DELETE" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(deleteStoredAudio(["a.bin"])).rejects.toBeInstanceOf(StorageDeleteError);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("deletes with bounded concurrency and reports the keys that failed", async () => {
    useR2();
    let active = 0;
    let peak = 0;
    const keys = Array.from({ length: 30 }, (_, i) => `k${i}.bin`);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 2));
      active -= 1;
      const key = new URL(url).pathname;
      return new Response(null, { status: key.endsWith("k3.bin") || key.endsWith("k7.bin") ? 500 : key.endsWith("k4.bin") ? 404 : 204 });
    }));
    const error = await deleteStoredAudio(keys).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageDeleteError);
    expect((error as StorageDeleteError).failedKeys.sort()).toEqual(["k3.bin", "k7.bin"]);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  it("also removes the same keys from Blob when it is configured, and ignores Blob errors", async () => {
    useR2();
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(null, { status: new URL(url).pathname.endsWith("bad.bin") ? 500 : 204 })));
    blob.del.mockRejectedValueOnce(new Error("blob down"));
    await expect(deleteStoredAudio(["a.bin"])).resolves.toBeUndefined();
    expect(blob.del).toHaveBeenCalledWith(["a.bin"]);
    blob.del.mockClear();
    // A key R2 failed to delete is not touched in Blob (it may be the only copy).
    await expect(deleteStoredAudio(["a.bin", "bad.bin"])).rejects.toBeInstanceOf(StorageDeleteError);
    expect(blob.del).toHaveBeenCalledWith(["a.bin"]);
  });

  it("serves reads through the proxy URL and signs GETs", async () => {
    useR2();
    expect((await storageGet("/a/b.bin")).url).toBe("/api/storage?key=a%2Fb.bin");
    const signed = new URL(await storageGetSignedUrl("a/b.bin"));
    expect(signed.host).toBe("acct.r2.cloudflarestorage.com");
    expect(signed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("does not use the multipart token flow", async () => {
    useR2();
    await expect(issueLargeUploadToken({ userId: 1, pathname: "1/recordings/x", size: 1 })).rejects.toThrow(/single signed upload/);
  });

  it("reports usage as unmetered without calling any list API", async () => {
    useR2();
    const usage = await getBlobUsage();
    expect(usage).toMatchObject({ configured: true, provider: "r2", metered: false });
    expect(blob.list).not.toHaveBeenCalled();
  });
});

describe("transfer budget with R2", () => {
  it("never trips the soft cap or the limit, and counts nothing", async () => {
    useR2();
    expect(isTransferMetered()).toBe(false);
    recordTransfer({ served: 50 * 1024 ** 3, fetched: 50 * 1024 ** 3 }, { flush: true });
    expect(await isTransferSoftCapReached()).toBe(false);
    expect(await isTransferLimitReached()).toBe(false);
    await expect(assertTransferHeadroomForImport()).resolves.toBeUndefined();
    const report = await getTransferReport();
    expect(report).toMatchObject({ unmetered: true, level: "ok", softCapReached: false });
  });
});

describe("health status text", () => {
  it("never includes secrets and names the likely cause", () => {
    expect(r2Status({ ok: true, status: 200 }).status).toBe("ok");
    expect(r2Status({ ok: false, status: 403 }).detail).toMatch(/refused/);
    expect(r2Status({ ok: true, status: 404 }).status).toBe("ok");
    expect(r2Status({ ok: false, status: null }).status).toBe("error");
    for (const s of [200, 403, 404, 500, null]) expect(r2Status({ ok: s === 200, status: s }).detail).not.toMatch(/AKIAR2KEY|r2-secret-xyz/);
  });
});
