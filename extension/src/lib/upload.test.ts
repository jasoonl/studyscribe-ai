import { describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import {
  assembleRecording,
  blobToDataUrl,
  INLINE_LIMIT_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  overallProgress,
  planUpload,
  recordingFileName,
  recordingMimeType,
  uploadRecordingAudio,
  withSiteCredentials,
} from "./upload";

const ORIGIN = "http://localhost:3107";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("planUpload", () => {
  it("uses one PUT up to 50MB and parts above it", () => {
    expect(planUpload(1)).toBe("single");
    expect(planUpload(MULTIPART_THRESHOLD_BYTES)).toBe("single");
    expect(planUpload(MULTIPART_THRESHOLD_BYTES + 1)).toBe("multipart");
  });

  it("refuses empty and oversized recordings", () => {
    expect(() => planUpload(0)).toThrow(/empty/);
    expect(() => planUpload(Number.NaN)).toThrow();
    expect(() => planUpload(1024 * 1024 * 1024 + 1)).toThrow(/1GB/);
  });
});

describe("recording files", () => {
  it("names the container without codec parameters", () => {
    expect(recordingMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(recordingMimeType("video/webm")).toBe("audio/webm");
    expect(recordingMimeType("audio/mp4")).toBe("audio/mp4");
    expect(recordingMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(recordingFileName("audio/webm", new Date("2026-10-13T09:05:07.123Z"))).toBe("tab-recording-2026-10-13T09-05-07Z.webm");
    expect(recordingFileName("audio/mp4", new Date("2026-10-13T09:05:07.123Z"))).toMatch(/\.mp4$/);
  });

  it("joins timesliced chunks and skips empty ones", async () => {
    const blob = assembleRecording([new Blob(["ab"]), new Blob([]), new Blob(["cd"])], "audio/webm");
    expect(blob.type).toBe("audio/webm");
    expect(await blob.text()).toBe("abcd");
    expect(() => assembleRecording([new Blob([])], "audio/webm")).toThrow(/No audio/);
  });

  it("encodes base64 in slices, so long recordings do not overflow the call stack", async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    const url = await blobToDataUrl(new Blob([bytes], { type: "audio/webm" }));
    expect(url.startsWith("data:audio/webm;base64,")).toBe(true);
    expect(Buffer.from(url.split(",")[1], "base64").equals(Buffer.from(bytes))).toBe(true);
  });

  it("maps each stage onto one progress bar", () => {
    expect(overallProgress("prepare")).toBe(5);
    expect(overallProgress("send", 0)).toBe(10);
    expect(overallProgress("send", 0.5)).toBe(50);
    expect(overallProgress("send", 2)).toBe(90);
    expect(overallProgress("create", 1)).toBe(100);
  });
});

describe("withSiteCredentials", () => {
  it("adds credentials only for the StudyScribe origin", async () => {
    const base = vi.fn(async () => new Response("ok"));
    const wrapped = withSiteCredentials(ORIGIN, base as unknown as typeof fetch);
    await wrapped(`${ORIGIN}/api/storage/upload-presigned`, { method: "POST" });
    await wrapped(new URL("https://vercel.com/api/blob/mpu"), { method: "POST" });
    expect(base.mock.calls[0]).toEqual([`${ORIGIN}/api/storage/upload-presigned`, { method: "POST", credentials: "include" }]);
    expect((base.mock.calls[1] as unknown[])[1]).toEqual({ method: "POST" });
  });
});

describe("uploadRecordingAudio", () => {
  const blob = new Blob(["fake-webm-audio"], { type: "audio/webm" });

  it("PUTs to the presigned URL with the server's generic content type", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ enabled: true, upload: { key: "1/recordings/abc-webm.bin", mimeType: "audio/webm", uploadUrl: "https://blob.example/put?sig=1", uploadContentType: "application/octet-stream" } }),
    );
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    const multipart = vi.fn();
    const progress: number[] = [];
    const result = await uploadRecordingAudio(blob, "tab.webm", { api: createApi(ORIGIN, fetchImpl), put, multipart }, p => progress.push(p));

    expect(result).toEqual({ audioUpload: { key: "1/recordings/abc-webm.bin", mimeType: "audio/webm" } });
    const [prepareUrl, prepareInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(prepareUrl).toBe(`${ORIGIN}/api/storage/upload-url`);
    expect(prepareInit.credentials).toBe("include");
    expect(JSON.parse(prepareInit.body as string)).toEqual({ fileName: "tab.webm", mimeType: "audio/webm", size: blob.size });
    const [putUrl, putInit] = put.mock.calls[0] as unknown as [string, RequestInit];
    expect(putUrl).toBe("https://blob.example/put?sig=1");
    expect(putInit.headers).toEqual({ "Content-Type": "application/octet-stream" });
    expect((putInit.body as Blob).type).toBe("application/octet-stream");
    expect(multipart).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBe(90);
  });

  it("sends large recordings in parts through the site's token endpoint", async () => {
    const big = { size: MULTIPART_THRESHOLD_BYTES + 10, type: "audio/webm" } as Blob;
    const fetchImpl = vi.fn(async () =>
      json({ enabled: true, upload: { key: "1/recordings/big-webm.bin", mimeType: "audio/webm", uploadUrl: "https://blob.example/put", uploadContentType: "application/octet-stream" } }),
    );
    const multipart = vi.fn(async ({ onProgress }: { onProgress: (f: number) => void }) => onProgress(0.5));
    const put = vi.fn();
    const progress: number[] = [];
    // Only the size decides the plan, so a stand-in object is enough; no 50MB buffer is allocated.
    await uploadRecordingAudio(big, "tab.webm", { api: createApi(ORIGIN, fetchImpl), put, multipart: multipart as never }, p => progress.push(p));
    expect(put).not.toHaveBeenCalled();
    expect(multipart).toHaveBeenCalledWith(
      expect.objectContaining({ key: "1/recordings/big-webm.bin", contentType: "application/octet-stream", handleUploadUrl: `${ORIGIN}/api/storage/upload-presigned`, size: big.size }),
    );
    expect(progress).toContain(50);
  });

  it("falls back to inline base64 when the server has no Blob store", async () => {
    const fetchImpl = vi.fn(async () => json({ enabled: false }, 409));
    const result = await uploadRecordingAudio(blob, "tab.webm", { api: createApi(ORIGIN, fetchImpl), put: vi.fn(), multipart: vi.fn() }, () => {});
    expect(result).toEqual({ audioBase64: `data:audio/webm;base64,${Buffer.from("fake-webm-audio").toString("base64")}` });
  });

  it("refuses inline uploads the server could not accept", async () => {
    const fetchImpl = vi.fn(async () => json({ enabled: false }, 409));
    const huge = { size: INLINE_LIMIT_BYTES + 1, type: "audio/webm" } as Blob;
    await expect(uploadRecordingAudio(huge, "tab.webm", { api: createApi(ORIGIN, fetchImpl), put: vi.fn(), multipart: vi.fn() }, () => {})).rejects.toThrow(/36MB/);
  });

  it("reports a signed-out session and storage errors", async () => {
    await expect(
      uploadRecordingAudio(blob, "tab.webm", { api: createApi(ORIGIN, async () => json({ error: "Sign in to upload recordings" }, 401)), put: vi.fn(), multipart: vi.fn() }, () => {}),
    ).rejects.toThrow(/Sign in/);
    const fetchImpl = vi.fn(async () =>
      json({ enabled: true, upload: { key: "k", mimeType: "audio/webm", uploadUrl: "https://blob.example/put", uploadContentType: "application/octet-stream" } }),
    );
    const put = vi.fn(async () => new Response("store suspended", { status: 403 }));
    await expect(uploadRecordingAudio(blob, "tab.webm", { api: createApi(ORIGIN, fetchImpl), put, multipart: vi.fn() }, () => {})).rejects.toThrow(/403: store suspended/);
  });
});
