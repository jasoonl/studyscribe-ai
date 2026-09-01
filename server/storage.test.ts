import { afterEach, describe, expect, it, vi } from "vitest";
import { isVercelBlobStorageConfigured, storageGet } from "./storage";

afterEach(() => {
  vi.unstubAllEnvs();
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
