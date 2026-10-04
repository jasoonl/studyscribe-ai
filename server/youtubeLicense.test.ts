import { afterEach, describe, expect, it, vi } from "vitest";
import { assertYouTubeCreativeCommons } from "./youtubeAudio";

const respond = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body })));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assertYouTubeCreativeCommons", () => {
  it("refuses everything when no API key is configured", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    await expect(assertYouTubeCreativeCommons("dQw4w9WgXcQ")).rejects.toThrow(/turned off/);
  });

  it("allows a Creative Commons video", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "k");
    respond({ items: [{ status: { license: "creativeCommon" } }] });
    await expect(assertYouTubeCreativeCommons("dQw4w9WgXcQ")).resolves.toBeUndefined();
  });

  it("refuses a standard-licence video, a missing video and an API failure", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "k");
    respond({ items: [{ status: { license: "youtube" } }] });
    await expect(assertYouTubeCreativeCommons("dQw4w9WgXcQ")).rejects.toThrow(/Creative Commons/);
    respond({ items: [] });
    await expect(assertYouTubeCreativeCommons("dQw4w9WgXcQ")).rejects.toThrow(/no public video/);
    respond({}, false);
    await expect(assertYouTubeCreativeCommons("dQw4w9WgXcQ")).rejects.toThrow(/Could not check/);
  });
});
