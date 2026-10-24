import { describe, expect, it } from "vitest";
import { buildRecorderOptions, RECORDER_AUDIO_BITS_PER_SECOND } from "./recorderOptions";

describe("buildRecorderOptions", () => {
  it("sets a speech-grade bitrate with the chosen type", () => {
    expect(buildRecorderOptions("audio/webm")).toEqual({ mimeType: "audio/webm", audioBitsPerSecond: 48_000 });
  });
  it("omits mimeType when the browser offered none", () => {
    expect(buildRecorderOptions("")).toEqual({ audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND });
  });
  it("stays between 32 and 96 kbps", () => {
    expect(RECORDER_AUDIO_BITS_PER_SECOND).toBeGreaterThanOrEqual(32_000);
    expect(RECORDER_AUDIO_BITS_PER_SECOND).toBeLessThanOrEqual(96_000);
  });
});
