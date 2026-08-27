import { describe, expect, it } from "vitest";
import { transcriptUpdateInputSchema } from "./transcriptInput";

describe("transcriptUpdateInputSchema", () => {
  it("accepts a non-empty transcript update", () => {
    expect(transcriptUpdateInputSchema.parse({ recordingId: 42, fullText: "Edited lecture notes." })).toMatchObject({
      recordingId: 42,
      fullText: "Edited lecture notes.",
    });
  });

  it("rejects empty transcript updates", () => {
    expect(() => transcriptUpdateInputSchema.parse({ recordingId: 42, fullText: "  " })).toThrow("Transcript cannot be empty");
  });
});
