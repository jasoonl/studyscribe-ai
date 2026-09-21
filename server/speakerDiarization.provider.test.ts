import { describe, expect, it } from "vitest";
import { submitTranscriptionJob, checkTranscriptionStatus } from "./speakerDiarization";

const providerIt = process.env.RUN_PROVIDER_INTEGRATION_TESTS === "true" ? it : it.skip;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AssemblyAI speaker diarization provider", () => {
  providerIt("returns a timestamped, speaker-labeled transcript for the documented public sample", async () => {
    const { providerId } = await submitTranscriptionJob({ audioUrl: "https://assembly.ai/wildfires.mp3" });

    const deadline = Date.now() + 12 * 60 * 1_000;
    let result = await checkTranscriptionStatus(providerId);
    while (result.status === "processing" && Date.now() < deadline) {
      await wait(3_000);
      result = await checkTranscriptionStatus(providerId);
    }

    if (result.status !== "completed") {
      throw new Error(`Expected a completed transcript, got status: ${result.status}`);
    }
    expect(result.text.length).toBeGreaterThan(100);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0]).toMatchObject({
      id: expect.any(String),
      start: expect.any(Number),
      end: expect.any(Number),
      text: expect.any(String),
      speaker: expect.stringMatching(/^Speaker /),
    });
  }, 13 * 60 * 1_000);
});
