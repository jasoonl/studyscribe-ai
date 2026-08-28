import { describe, expect, it } from "vitest";
import { transcribeWithSpeakerDiarization } from "./speakerDiarization";

const providerIt = process.env.RUN_PROVIDER_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("AssemblyAI speaker diarization provider", () => {
  providerIt("returns a timestamped, speaker-labeled transcript for the documented public sample", async () => {
    const transcript = await transcribeWithSpeakerDiarization({
      audioUrl: "https://assembly.ai/wildfires.mp3",
    });

    expect(transcript.text.length).toBeGreaterThan(100);
    expect(transcript.segments.length).toBeGreaterThan(0);
    expect(transcript.segments[0]).toMatchObject({
      id: expect.any(String),
      start: expect.any(Number),
      end: expect.any(Number),
      text: expect.any(String),
      speaker: expect.stringMatching(/^Speaker /),
    });
  }, 13 * 60 * 1_000);
});
