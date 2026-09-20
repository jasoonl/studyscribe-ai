import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTranscriptionAudioToken,
  verifyTranscriptionAudioToken,
  buildTranscriptionAudioUrl,
} from "./transcriptionAudioLink";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("transcription audio tokens", () => {
  it("round-trips the storage key it was issued for", () => {
    const token = createTranscriptionAudioToken("9/recordings/abc-webm.bin");
    expect(verifyTranscriptionAudioToken(token)).toBe("9/recordings/abc-webm.bin");
  });

  it("rejects a token whose payload was tampered with", () => {
    const token = createTranscriptionAudioToken("9/recordings/abc-webm.bin");
    const [, signature] = token.split(".");
    // Try to point a validly-signed-looking token at someone else's recording.
    const forgedPayload = Buffer.from(
      JSON.stringify({ k: "1/recordings/victim-webm.bin", e: Date.now() + 60_000 }),
    ).toString("base64url");
    expect(verifyTranscriptionAudioToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    vi.stubEnv("JWT_SECRET", "secret-one");
    const token = createTranscriptionAudioToken("9/recordings/abc-webm.bin");
    vi.stubEnv("JWT_SECRET", "secret-two");
    expect(verifyTranscriptionAudioToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createTranscriptionAudioToken("9/recordings/abc-webm.bin", 1000);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    expect(verifyTranscriptionAudioToken(token)).toBeNull();
  });

  it("rejects malformed and empty tokens", () => {
    for (const bad of ["", "no-separator", ".", "a.b.c.d", "!!!.???"]) {
      expect(verifyTranscriptionAudioToken(bad), bad).toBeNull();
    }
  });

  it("stays valid well past the storage signed-URL lifetime for queued jobs", () => {
    const token = createTranscriptionAudioToken("9/recordings/abc-webm.bin");
    vi.useFakeTimers();
    // Storage's own signed URLs last 10 minutes; a queued provider job can
    // easily start later than that.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(verifyTranscriptionAudioToken(token)).toBe("9/recordings/abc-webm.bin");
  });
});

describe("buildTranscriptionAudioUrl", () => {
  it("ends in a real audio extension so the provider can identify the format", () => {
    const url = buildTranscriptionAudioUrl("9/recordings/abc-webm.bin", "audio/webm", "https://app.example");
    expect(url).toMatch(/^https:\/\/app\.example\/api\/transcription-audio\/.+\/audio\.webm$/);
  });

  it("maps each supported type to the extension providers expect", () => {
    const base = "https://app.example";
    expect(buildTranscriptionAudioUrl("k", "audio/mpeg", base)).toMatch(/audio\.mp3$/);
    expect(buildTranscriptionAudioUrl("k", "audio/mp4", base)).toMatch(/audio\.m4a$/);
    expect(buildTranscriptionAudioUrl("k", "audio/wav", base)).toMatch(/audio\.wav$/);
    expect(buildTranscriptionAudioUrl("k", "audio/ogg", base)).toMatch(/audio\.ogg$/);
  });

  it("tolerates a content type carrying codec parameters", () => {
    expect(buildTranscriptionAudioUrl("k", "audio/webm;codecs=opus", "https://app.example")).toMatch(/audio\.webm$/);
  });

  it("produces a URL whose token resolves back to the key", () => {
    const url = buildTranscriptionAudioUrl("9/recordings/abc-webm.bin", "audio/webm", "https://app.example");
    const token = new URL(url).pathname.split("/")[3];
    expect(verifyTranscriptionAudioToken(token)).toBe("9/recordings/abc-webm.bin");
  });
});
