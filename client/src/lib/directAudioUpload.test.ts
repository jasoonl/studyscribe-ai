import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAudioDirectly } from "./directAudioUpload";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadAudioDirectly", () => {
  it("uses a short-lived upload URL and returns the server-owned storage key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        enabled: true,
        upload: { key: "17/recordings/audio.webm", mimeType: "audio/webm", uploadUrl: "https://blob.example/upload" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const progress = vi.fn();

    const result = await uploadAudioDirectly(new Blob(["audio"], { type: "audio/webm" }), "lecture.webm", progress);

    expect(result).toEqual({ key: "17/recordings/audio.webm", mimeType: "audio/webm" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/storage/upload-url");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://blob.example/upload");
    expect(progress).toHaveBeenCalledWith(25);
    expect(progress).toHaveBeenCalledWith(65);
  });

  it("returns null when the temporary Manus environment has no Vercel Blob connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(uploadAudioDirectly(new Blob(["audio"], { type: "audio/webm" }), "lecture.webm")).resolves.toBeNull();
  });
});
