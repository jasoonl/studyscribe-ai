import { describe, expect, it } from "vitest";
import { describeAiFailure } from "./aiErrors";

const wrapped = (inner: string) => new Error("Failed to generate flashcards", { cause: new Error(inner) });

describe("describeAiFailure", () => {
  it("explains provider problems found anywhere in the cause chain, without the raw response", () => {
    expect(describeAiFailure(wrapped("LLM invoke failed: 429 Too Many Requests – {\"error\":\"rate\"}"))?.code).toBe("TOO_MANY_REQUESTS");
    const outage = describeAiFailure(new Error("Failed to generate study notes: LLM invoke failed: 503 Service Unavailable – upstream"));
    expect(outage).toEqual({ code: "SERVICE_UNAVAILABLE", message: "The AI service is having trouble right now. Try again in a few minutes." });
    expect(describeAiFailure(wrapped("LLM invoke failed: 401 Unauthorized – bad key"))?.message).toMatch(/key/);
    expect(describeAiFailure(wrapped("LLM invoke failed: 400 Bad Request – context length"))?.message).toMatch(/too long/);
  });
  it("recognises timeouts, network failures and a missing key", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(describeAiFailure(timeout)?.code).toBe("TIMEOUT");
    expect(describeAiFailure(new TypeError("fetch failed"))?.code).toBe("SERVICE_UNAVAILABLE");
    expect(describeAiFailure(new Error("AI is not configured: add OPENAI_API_KEY for external hosting"))?.message).toMatch(/not set up/);
  });
  it("leaves other errors alone", () => {
    expect(describeAiFailure(new Error("Recording not found"))).toBeNull();
    expect(describeAiFailure(new Error("Transcript not available"))).toBeNull();
  });
});
