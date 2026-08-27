import { describe, expect, it } from "vitest";
import { getFileExtension } from "./_core/voiceTranscription";

describe("getFileExtension", () => {
  it.each([
    ["audio/mpeg", "mp3"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["audio/ogg", "ogg"],
    ["audio/webm", "webm"],
    ["video/webm", "webm"],
    ["audio/m4a", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["audio/mp4", "m4a"],
    ["video/mp4", "mp4"],
  ])("maps %s to the expected filename extension", (mimeType, extension) => {
    expect(getFileExtension(mimeType)).toBe(extension);
  });
});
