import { describe, expect, it } from "vitest";
import { createPlaybackToken, playbackPath, verifyPlaybackToken } from "./playbackLink";
import { createTranscriptionAudioToken } from "./transcriptionAudioLink";
import { compareVersions, isValidVersion, needsUpdate } from "@shared/mobile";

describe("playback links", () => {
  const grant = { key: "7/recordings/abc-m4a.bin", userId: 7, recordingId: 12 };

  it("round-trips the key, user and recording", () => {
    expect(verifyPlaybackToken(createPlaybackToken(grant))).toEqual(grant);
  });

  it("refuses an edited, expired or transcription token", () => {
    const token = createPlaybackToken(grant);
    const [payload, signature] = token.split(".");
    const edited = Buffer.from(JSON.stringify({ k: "8/recordings/other.bin", u: 7, r: 12, e: Date.now() + 1000 })).toString("base64url");
    expect(verifyPlaybackToken(`${edited}.${signature}`)).toBeNull();
    expect(verifyPlaybackToken(`${payload}.x${signature.slice(1)}`)).toBeNull();
    expect(verifyPlaybackToken(createPlaybackToken(grant, 1000, Date.now() - 5000))).toBeNull();
    // A link made for the transcription provider is not a playback link.
    expect(verifyPlaybackToken(createTranscriptionAudioToken(grant.key))).toBeNull();
    expect(verifyPlaybackToken("")).toBeNull();
  });

  it("ends the path in a real audio extension", () => {
    expect(playbackPath("tok", "audio/mp4")).toBe("/api/storage/playback/tok/audio.m4a");
    expect(playbackPath("tok", "audio/aac")).toBe("/api/storage/playback/tok/audio.aac");
    expect(playbackPath("tok", "application/octet-stream")).toBe("/api/storage/playback/tok/audio.m4a");
  });
});

describe("app versions", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });

  it("asks for an update only below the minimum", () => {
    expect(needsUpdate("1.0.0", "1.1.0")).toBe(true);
    expect(needsUpdate("1.1.0", "1.1.0")).toBe(false);
    expect(needsUpdate("1.0.0", null)).toBe(false);
  });

  it("validates versions an admin types", () => {
    expect(isValidVersion("1.2.3")).toBe(true);
    expect(isValidVersion("1")).toBe(true);
    expect(isValidVersion("1.2.3.4")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
  });
});
