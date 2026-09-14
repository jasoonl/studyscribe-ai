import { afterEach, describe, expect, it, vi } from "vitest";

const issueSignedToken = vi.fn(async () => ({
  delegationToken: "delegation-token",
  clientSigningToken: "client-signing-token",
  validUntil: Date.now() + 60_000,
}));
const presignUrl = vi.fn(async () => ({ presignedUrl: "https://blob.example/presigned-put-url" }));

vi.mock("@vercel/blob", () => ({
  issueSignedToken: (...args: unknown[]) => issueSignedToken(...args),
  presignUrl: (...args: unknown[]) => presignUrl(...args),
  put: vi.fn(),
  get: vi.fn(),
}));

import {
  isVercelBlobStorageConfigured,
  storageGet,
  normalizeAudioMimeType,
  contentTypeFromStorageKey,
  createDirectAudioUpload,
} from "./storage";

afterEach(() => {
  vi.unstubAllEnvs();
  issueSignedToken.mockClear();
  presignUrl.mockClear();
});

describe("portable storage selection", () => {
  it("uses the private Vercel playback route only when Blob credentials are connected", async () => {
    vi.stubEnv("BLOB_STORE_ID", "store_123");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc_123");
    expect(isVercelBlobStorageConfigured()).toBe(true);
    await expect(storageGet("9/recordings/lecture.webm")).resolves.toEqual({
      key: "9/recordings/lecture.webm",
      url: "/api/storage?key=9%2Frecordings%2Flecture.webm",
    });
  });

  it("retains the Manus storage route until Vercel Blob is connected", async () => {
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(isVercelBlobStorageConfigured()).toBe(false);
    await expect(storageGet("9/recordings/lecture.webm")).resolves.toEqual({
      key: "9/recordings/lecture.webm",
      url: "/manus-storage/9/recordings/lecture.webm",
    });
  });
});

describe("normalizeAudioMimeType", () => {
  it("strips codec parameters MediaRecorder attaches to the reported mimeType", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeAudioMimeType("audio/mp4;codecs=mp4a.40.2")).toBe("audio/mp4");
  });

  it("relabels video/webm and video/mp4 to their audio equivalents", () => {
    // Some browsers report an audio-only MediaRecorder's container under a
    // video/* label even though no video track is involved — this is the
    // exact case that caused Vercel Blob to reject real recordings.
    expect(normalizeAudioMimeType("video/webm")).toBe("audio/webm");
    expect(normalizeAudioMimeType("video/webm;codecs=vp9,opus")).toBe("audio/webm");
    expect(normalizeAudioMimeType("video/mp4")).toBe("audio/mp4");
  });

  it("lowercases and passes through already-normal audio types unchanged", () => {
    expect(normalizeAudioMimeType("AUDIO/WAV")).toBe("audio/wav");
    expect(normalizeAudioMimeType("audio/ogg")).toBe("audio/ogg");
  });
});

describe("contentTypeFromStorageKey", () => {
  it("maps every supported extension to its playback Content-Type (legacy dot-extension keys)", () => {
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.mp3")).toBe("audio/mpeg");
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.wav")).toBe("audio/wav");
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.ogg")).toBe("audio/ogg");
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.webm")).toBe("audio/webm");
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.mp4")).toBe("audio/mp4");
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.m4a")).toBe("audio/mp4");
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.WEBM")).toBe("audio/webm");
  });

  it("falls back to a generic type for an unknown or missing extension", () => {
    expect(contentTypeFromStorageKey("1/recordings/abc-lecture.xyz")).toBe("application/octet-stream");
    expect(contentTypeFromStorageKey("1/recordings/no-extension")).toBe("application/octet-stream");
  });

  it("recovers the real audio type from the neutral-extension label keys createDirectAudioUpload produces", () => {
    // These keys deliberately end in .bin, not .webm/.mp4 (see
    // createDirectAudioUpload), so playback must read the embedded label.
    expect(contentTypeFromStorageKey("1/recordings/abc123-webm.bin")).toBe("audio/webm");
    expect(contentTypeFromStorageKey("1/recordings/abc123-mp4.bin")).toBe("audio/mp4");
    expect(contentTypeFromStorageKey("1/recordings/abc123-mp3.bin")).toBe("audio/mpeg");
    expect(contentTypeFromStorageKey("1/recordings/abc123-wav.bin")).toBe("audio/wav");
    expect(contentTypeFromStorageKey("1/recordings/abc123-ogg.bin")).toBe("audio/ogg");
    expect(contentTypeFromStorageKey("1/recordings/abc123-m4a.bin")).toBe("audio/mp4");
  });

  it("falls back to a generic type for a .bin key with an unrecognized label", () => {
    expect(contentTypeFromStorageKey("1/recordings/abc123-audio.bin")).toBe("application/octet-stream");
  });
});

describe("createDirectAudioUpload", () => {
  const baseInput = { userId: 1, fileName: "recording.webm", size: 1024 };

  it("returns null when Vercel Blob isn't configured, without calling Blob at all", async () => {
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    await expect(createDirectAudioUpload({ ...baseInput, mimeType: "audio/webm" })).resolves.toBeNull();
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it("rejects a genuinely unsupported format before ever contacting Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token_123");
    await expect(
      createDirectAudioUpload({ ...baseInput, mimeType: "image/png" })
    ).rejects.toThrow(/Unsupported audio format/);
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it("rejects a file outside the size bounds before ever contacting Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token_123");
    await expect(
      createDirectAudioUpload({ ...baseInput, mimeType: "audio/webm", size: 0 })
    ).rejects.toThrow(/500MB/);
    await expect(
      createDirectAudioUpload({ ...baseInput, mimeType: "audio/webm", size: 600 * 1024 * 1024 })
    ).rejects.toThrow(/500MB/);
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it("accepts a video/webm-labeled recording and never declares it to Blob as anything but the generic type", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token_123");
    const result = await createDirectAudioUpload({ ...baseInput, mimeType: "video/webm;codecs=vp9,opus" });

    expect(result).not.toBeNull();
    // The real, validated audio type is still tracked for the caller...
    expect(result?.mimeType).toBe("audio/webm");
    // ...but Blob is only ever told the universally-accepted generic type,
    // since it has rejected audio/webm and video/webm outright in the past.
    expect(result?.uploadContentType).toBe("application/octet-stream");
    expect(issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ allowedContentTypes: ["application/octet-stream"] })
    );
    expect(presignUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowedContentTypes: ["application/octet-stream"] })
    );
  });

  it("never gives the storage key a .webm or .mp4 extension, even for those exact input formats", async () => {
    // The storage key's own extension is what Vercel Blob's presigned PUT
    // actually validates the content type against (independent of the
    // declared header/allowedContentTypes) — .webm/.mp4 are canonically
    // registered as video/* in the standard MIME database, so a key ending
    // in either was rejected outright regardless of any other fix. This is
    // the assertion that pins the real root cause of the recurring bug.
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token_123");
    const webm = await createDirectAudioUpload({ ...baseInput, mimeType: "video/webm" });
    const mp4 = await createDirectAudioUpload({ ...baseInput, mimeType: "video/mp4" });
    expect(webm?.key).not.toMatch(/\.webm$/);
    expect(mp4?.key).not.toMatch(/\.mp4$/);
    expect(webm?.key).toMatch(/-webm\.bin$/);
    expect(mp4?.key).toMatch(/-mp4\.bin$/);
  });

  it("scopes the storage key to the uploading user", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token_123");
    const result = await createDirectAudioUpload({ ...baseInput, userId: 42, mimeType: "audio/mp3" });
    expect(result?.key).toMatch(/^42\/recordings\//);
    expect(result?.key).toMatch(/-mp3\.bin$/);
  });
});
