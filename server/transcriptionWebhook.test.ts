import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidAssemblyAiWebhookSecret } from "./transcriptionWebhook";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AssemblyAI webhook authorization", () => {
  it("accepts only the configured webhook secret", () => {
    vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "long-random-secret");
    expect(isValidAssemblyAiWebhookSecret("long-random-secret")).toBe(true);
    expect(isValidAssemblyAiWebhookSecret("wrong-secret")).toBe(false);
    expect(isValidAssemblyAiWebhookSecret(undefined)).toBe(false);
  });

  it("fails closed when the webhook secret is not configured", () => {
    vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "");
    expect(isValidAssemblyAiWebhookSecret("anything")).toBe(false);
  });
});
