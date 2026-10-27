import { describe, expect, it, vi } from "vitest";
import { MULTIPART_PART_BYTES, getR2Config, isR2StorageConfigured, presign, presignGet, presignPut, r2CheckBucket, r2Delete, r2Head, r2PutBuffer, r2PutStream, signingKey, uriEncode } from "./r2";

const config = { accountId: "acct123", accessKeyId: "AKIATESTKEYID", secretAccessKey: "super-secret-value-123", bucket: "my-bucket" };
const NOW = new Date("2026-10-27T12:00:00Z");

function expectNoSecrets(message: string) {
  expect(message).not.toContain(config.secretAccessKey);
  expect(message).not.toContain(config.accessKeyId);
  expect(message).not.toContain("X-Amz");
  expect(message).not.toContain("http");
}

describe("SigV4 (AWS published examples)", () => {
  it("derives the documented signing key", () => {
    const key = signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam");
    expect(key.toString("hex")).toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });

  it("matches the S3 presigned GET example from the AWS docs", () => {
    const url = presign({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
      expiresInSeconds: 86400,
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("encodes like RFC 3986", () => {
    expect(uriEncode("a b/c~d+é")).toBe("a%20b%2Fc~d%2B%C3%A9");
    expect(uriEncode("a/b", false)).toBe("a/b");
  });

  it("rejects an expiry outside 1 second to 7 days", () => {
    const base = { method: "GET", host: "h", path: "/p", accessKeyId: "a", secretAccessKey: "b" };
    expect(() => presign({ ...base, expiresInSeconds: 0 })).toThrow();
    expect(() => presign({ ...base, expiresInSeconds: 8 * 24 * 3600 })).toThrow();
  });
});

describe("configuration", () => {
  const env = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" };
  it("needs all four variables", () => {
    expect(isR2StorageConfigured(env)).toBe(true);
    for (const name of Object.keys(env)) expect(isR2StorageConfigured({ ...env, [name]: "" })).toBe(false);
    expect(isR2StorageConfigured({})).toBe(false);
  });
  it("accepts an endpoint override", () => {
    expect(getR2Config({ ...env, R2_ENDPOINT: "http://127.0.0.1:9000" })?.endpoint).toBe("http://127.0.0.1:9000");
    expect(getR2Config(env)?.endpoint).toBeUndefined();
  });
});

describe("presigned URLs", () => {
  it("PUT binds content type and length and uses path-style R2 addressing", () => {
    const url = new URL(presignPut(config, "12/recordings/abc-mp3.bin", { contentType: "application/octet-stream", contentLength: 1234, now: NOW }));
    expect(url.origin).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/my-bucket/12/recordings/abc-mp3.bin");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIATESTKEYID/20261027/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.toString()).not.toContain(config.secretAccessKey);
  });

  it("a different length or type gives a different signature", () => {
    const sign = (contentLength: number, contentType = "application/octet-stream") =>
      new URL(presignPut(config, "k.bin", { contentType, contentLength, now: NOW })).searchParams.get("X-Amz-Signature");
    expect(sign(10)).toBe(sign(10));
    expect(sign(10)).not.toBe(sign(11));
    expect(sign(10)).not.toBe(sign(10, "audio/mpeg"));
  });

  it("refuses a zero length", () => {
    expect(() => presignPut(config, "k.bin", { contentType: "x/y", contentLength: 0 })).toThrow();
  });

  it("GET signs only the host and is short-lived by default", () => {
    const url = new URL(presignGet(config, "a b.bin", { now: NOW }));
    expect(url.pathname).toBe("/my-bucket/a%20b.bin");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("honours the endpoint override (including a port)", () => {
    const url = new URL(presignGet({ ...config, endpoint: "http://127.0.0.1:9000" }, "k.bin", { now: NOW }));
    expect(url.origin).toBe("http://127.0.0.1:9000");
    expect(url.pathname).toBe("/my-bucket/k.bin");
  });
});

describe("object operations", () => {
  const ok = (status = 200, headers: Record<string, string> = {}, body = "") => new Response(status === 204 || status === 404 ? null : body, { status, headers });

  it("HEAD returns size and type, null on 404, an error otherwise", async () => {
    const fetcher = vi.fn(async () => ok(200, { "content-length": "42", "content-type": "application/octet-stream" }));
    expect(await r2Head(config, "k.bin", fetcher as never)).toEqual({ size: 42, contentType: "application/octet-stream" });
    expect((fetcher.mock.calls[0] as unknown[])[1]).toMatchObject({ method: "HEAD" });
    expect(await r2Head(config, "k.bin", (async () => ok(404)) as never)).toBeNull();
    await expect(r2Head(config, "k.bin", (async () => ok(403)) as never)).rejects.toThrow(/403/);
  });

  it("DELETE accepts 204 and 404 and fails otherwise without leaking secrets", async () => {
    await expect(r2Delete(config, "k.bin", (async () => ok(204)) as never)).resolves.toBeUndefined();
    await expect(r2Delete(config, "k.bin", (async () => ok(404)) as never)).resolves.toBeUndefined();
    const error = await r2Delete(config, "k.bin", (async () => ok(500)) as never).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/500/);
    expectNoSecrets((error as Error).message);
  });

  it("network failures and timeouts do not echo the URL", async () => {
    const boom = (async (url: string) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    }) as never;
    const error = await r2Head(config, "k.bin", boom).catch((e: Error) => e);
    expectNoSecrets((error as Error).message);
    const timeout = (async () => {
      throw Object.assign(new Error("slow"), { name: "TimeoutError" });
    }) as never;
    await expect(r2Delete(config, "k.bin", timeout)).rejects.toThrow(/timed out/);
  });

  it("PUT sends the signed content type and the bytes", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ok(200));
    await r2PutBuffer(config, "k.bin", new Uint8Array([1, 2, 3]), "text/plain", fetcher as never);
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect((init as RequestInit).headers).toEqual({ "Content-Type": "text/plain" });
    expect((init as RequestInit).method).toBe("PUT");
    await expect(r2PutBuffer(config, "k.bin", new Uint8Array([1]), "text/plain", (async () => ok(403)) as never)).rejects.toThrow(/403/);
  });

  it("bucket check reports status and never throws", async () => {
    const seen: string[] = [];
    expect(await r2CheckBucket(config, (async (url: string) => { seen.push(url); return ok(404); }) as never)).toEqual({ ok: true, status: 404 });
    expect(new URL(seen[0]).pathname).toBe("/my-bucket/.healthcheck");
    expect(await r2CheckBucket(config, (async () => ok(200)) as never)).toEqual({ ok: true, status: 200 });
    expect(await r2CheckBucket(config, (async () => ok(403)) as never)).toEqual({ ok: false, status: 403 });
    expect(await r2CheckBucket(config, (async () => { throw new Error("down"); }) as never)).toEqual({ ok: false, status: null });
  });
});

describe("streamed upload", () => {
  const streamOf = (...chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close(); } });

  it("uses a single PUT under one part", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const result = await r2PutStream(config, "k.bin", streamOf(new Uint8Array(1000)), "application/octet-stream", fetcher as never);
    expect(result.bytes).toBe(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty body", async () => {
    await expect(r2PutStream(config, "k.bin", streamOf(), "application/octet-stream", (async () => new Response(null)) as never)).rejects.toThrow(/empty/);
  });

  it("uses multipart for larger bodies and completes with every part", async () => {
    const calls: Array<{ url: URL; method: string; size: number }> = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const body = init?.body as Uint8Array | string | undefined;
      calls.push({ url, method: init?.method ?? "GET", size: typeof body === "string" ? body.length : body?.byteLength ?? 0 });
      if (init?.method === "POST" && url.searchParams.has("uploads")) return new Response("<InitiateMultipartUploadResult><UploadId>UP1</UploadId></InitiateMultipartUploadResult>");
      if (init?.method === "PUT") return new Response(null, { status: 200, headers: { etag: `"etag${url.searchParams.get("partNumber")}"` } });
      return new Response("<CompleteMultipartUploadResult/>", { status: 200 });
    });
    const total = MULTIPART_PART_BYTES * 2 + 5;
    const result = await r2PutStream(config, "k.bin", streamOf(new Uint8Array(MULTIPART_PART_BYTES + 3), new Uint8Array(total - MULTIPART_PART_BYTES - 3)), "application/octet-stream", fetcher as never);
    expect(result.bytes).toBe(total);
    const parts = calls.filter(c => c.method === "PUT");
    expect(parts.map(p => p.size)).toEqual([MULTIPART_PART_BYTES, MULTIPART_PART_BYTES, 5]);
    expect(parts.every(p => p.url.searchParams.get("uploadId") === "UP1")).toBe(true);
    const complete = calls[calls.length - 1];
    expect(complete.method).toBe("POST");
    expect(complete.url.searchParams.get("uploadId")).toBe("UP1");
  });

  it("aborts the multipart upload when a part fails", async () => {
    const methods: string[] = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      methods.push(`${init?.method}${url.searchParams.has("uploadId") ? ":upload" : ""}`);
      if (init?.method === "POST") return new Response("<UploadId>UP1</UploadId>");
      if (init?.method === "PUT") return new Response(null, { status: 500 });
      return new Response(null, { status: 204 });
    });
    const error = await r2PutStream(config, "k.bin", streamOf(new Uint8Array(MULTIPART_PART_BYTES * 2)), "application/octet-stream", fetcher as never).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/500/);
    expectNoSecrets((error as Error).message);
    expect(methods[methods.length - 1]).toBe("DELETE:upload");
  });
});
