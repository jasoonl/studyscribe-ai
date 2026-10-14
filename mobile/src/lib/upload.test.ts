import { MULTIPART_THRESHOLD_BYTES, PART_SIZE_BYTES, contentTypeFor, planParts, presignedMpuUrl, storeIdFromDelegationToken, uploadAudio, type UploadIo, type UploadSource } from "./upload";

const MB = 1024 * 1024;
const delegation = `${Buffer.from(JSON.stringify({ storeId: "store_abc123" })).toString("base64url")}.sig`;

function source(size: number, name = "lecture.mp4", mimeType = "video/mp4"): UploadSource & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    name,
    mimeType,
    size,
    reads,
    async readChunk(offset, length) {
      reads.push([offset, length]);
      return new Uint8Array(length);
    },
    async readBase64() {
      return "QUJD";
    },
  };
}

type Call = { url: string; init: RequestInit };

function io(handler: (url: string, init: RequestInit) => Response | Promise<Response>, put?: UploadIo["putFile"]): UploadIo & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    apiBase: "https://api.test",
    token: "session-token",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    putFile: put ?? (async () => ({ status: 200, body: "" })),
    sleep: async () => undefined,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const prepared = { enabled: true, upload: { key: "7/recordings/uuid-mp4.bin", mimeType: "audio/mp4", uploadUrl: "https://blob.test/put", uploadContentType: "application/octet-stream" } };

describe("planParts", () => {
  it("splits into 8MB parts with a shorter last part", () => {
    const parts = planParts(20 * MB);
    expect(parts).toEqual([
      { partNumber: 1, start: 0, length: PART_SIZE_BYTES },
      { partNumber: 2, start: 8 * MB, length: PART_SIZE_BYTES },
      { partNumber: 3, start: 16 * MB, length: 4 * MB },
    ]);
  });

  it("covers every byte exactly once", () => {
    const size = 1024 * MB - 123;
    const parts = planParts(size);
    expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(size);
    parts.forEach((part, index) => index > 0 && expect(part.start).toBe(parts[index - 1].start + parts[index - 1].length));
  });

  it("handles empty and invalid sizes", () => {
    expect(planParts(0)).toEqual([]);
    expect(planParts(Number.NaN)).toEqual([]);
  });
});

describe("Blob helpers", () => {
  it("reads the store id from a delegation token", () => {
    expect(storeIdFromDelegationToken(delegation)).toBe("abc123");
  });

  it("signs every multipart call with the presigned parameters", () => {
    const url = new URL(presignedMpuUrl("7/recordings/a.bin", { params: { expires: "123" }, delegationToken: delegation, signature: "sig" }));
    expect(url.pathname).toBe("/api/blob/mpu");
    expect(url.searchParams.get("pathname")).toBe("7/recordings/a.bin");
    expect(url.searchParams.get("expires")).toBe("123");
    expect(url.searchParams.get("vercel-blob-delegation")).toBe(delegation);
    expect(url.searchParams.get("vercel-blob-signature")).toBe("sig");
  });

  it("falls back to the extension when the picker reports a generic type", () => {
    expect(contentTypeFor("Lecture.MOV", "application/octet-stream")).toBe("video/quicktime");
    expect(contentTypeFor("talk.m4a", null)).toBe("audio/mp4");
    expect(contentTypeFor("talk.mp3", "audio/mpeg; charset=binary")).toBe("audio/mpeg");
  });
});

describe("uploadAudio", () => {
  it("sends a small file as one PUT with the session as bearer token", async () => {
    let putHeaders: Record<string, string> = {};
    const transport = io(
      () => json(prepared),
      async (_url, headers, onProgress) => {
        putHeaders = headers;
        onProgress(5 * MB);
        return { status: 200, body: "" };
      },
    );
    const progress: number[] = [];
    const result = await uploadAudio(source(10 * MB), transport, (value) => progress.push(value));
    expect(result).toEqual({ kind: "stored", key: prepared.upload.key, mimeType: "audio/mp4" });
    expect(transport.calls).toHaveLength(1);
    expect((transport.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
    expect(JSON.parse(String(transport.calls[0].init.body))).toEqual({ fileName: "lecture.mp4", mimeType: "video/mp4", size: 10 * MB });
    expect(putHeaders).toEqual({ "Content-Type": "application/octet-stream" });
    expect(progress).toEqual([0.5, 1]);
  });

  it("reports a failed PUT", async () => {
    const transport = io(() => json(prepared), async () => ({ status: 403, body: "denied" }));
    await expect(uploadAudio(source(MB), transport)).rejects.toThrow("(403: denied)");
  });

  it("falls back to an inline upload when the server has no Blob storage", async () => {
    const transport = io(() => new Response(JSON.stringify({ enabled: false }), { status: 409 }));
    await expect(uploadAudio(source(2 * MB, "a.aac", "audio/aac"), transport)).resolves.toEqual({ kind: "inline", base64: "QUJD", mimeType: "audio/aac" });
  });

  it("refuses an inline upload that is too large", async () => {
    const transport = io(() => new Response("{}", { status: 409 }));
    await expect(uploadAudio(source(40 * MB), transport)).rejects.toThrow("15MB");
  });

  it("sends files over 50MB in parts, reading each part from disk, then completes in order", async () => {
    const size = MULTIPART_THRESHOLD_BYTES + 20 * MB; // 70MB -> 9 parts
    const file = source(size);
    const uploadedParts: number[] = [];
    let attemptsOnPart3 = 0;
    const transport = io(async (url, init) => {
      if (url.endsWith("/api/storage/upload-url")) return json(prepared);
      if (url.endsWith("/api/storage/upload-presigned")) {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ type: "blob.generate-presigned-url", payload: { pathname: prepared.upload.key, clientPayload: JSON.stringify({ size }), multipart: true } });
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
        return json({ presignedUrlPayload: { params: {}, delegationToken: delegation, signature: "sig" } });
      }
      const headers = init.headers as Record<string, string>;
      expect(headers["x-vercel-blob-store-id"]).toBe("abc123");
      expect(headers["x-vercel-blob-access"]).toBe("private");
      if (headers["x-mpu-action"] === "create") return json({ key: "mpu-key", uploadId: "upload-1" });
      if (headers["x-mpu-action"] === "upload") {
        const part = Number(headers["x-mpu-part-number"]);
        // One transient failure: the part is retried on its own.
        if (part === 3 && attemptsOnPart3++ === 0) return new Response("busy", { status: 503 });
        uploadedParts.push(part);
        return json({ etag: `etag-${part}` });
      }
      if (headers["x-mpu-action"] === "complete") {
        const parts = JSON.parse(String(init.body));
        expect(parts.map((part: { partNumber: number }) => part.partNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(parts[2]).toEqual({ etag: "etag-3", partNumber: 3 });
        return json({ url: "https://blob.test/done" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const progress: number[] = [];
    const result = await uploadAudio(file, transport, (value) => progress.push(value));
    expect(result.kind).toBe("stored");
    expect(uploadedParts.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(attemptsOnPart3).toBe(2);
    expect(file.reads.reduce((sum, [, length]) => sum + length, 0)).toBe(size);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("stops on a part the store refuses outright", async () => {
    const transport = io(async (url, init) => {
      if (url.endsWith("/upload-url")) return json(prepared);
      if (url.endsWith("/upload-presigned")) return json({ presignedUrlPayload: { params: {}, delegationToken: delegation, signature: "sig" } });
      const action = (init.headers as Record<string, string>)["x-mpu-action"];
      if (action === "create") return json({ key: "k", uploadId: "u" });
      return json({ error: { message: "Store suspended" } }, 403);
    });
    await expect(uploadAudio(source(60 * MB), transport)).rejects.toThrow("Store suspended");
  });
});
