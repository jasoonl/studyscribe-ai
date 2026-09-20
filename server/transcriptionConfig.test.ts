import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAssemblyAiWebhookUrl, getTranscriptionConfigStatus } from "./speakerDiarization";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildAssemblyAiWebhookUrl", () => {
  it("builds the callback URL from a well-formed origin", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://studyscribe-ai.vercel.app");
    expect(buildAssemblyAiWebhookUrl()).toBe("https://studyscribe-ai.vercel.app/api/webhooks/assemblyai");
  });

  it("names the problem when PUBLIC_APP_URL is missing its scheme", () => {
    // This is the misconfiguration that previously surfaced only as a bare
    // "Invalid URL" and an unexplained failed transcript.
    vi.stubEnv("PUBLIC_APP_URL", "studyscribe-ai.vercel.app");
    expect(() => buildAssemblyAiWebhookUrl()).toThrow(/must include the scheme/i);
  });

  it("says so when PUBLIC_APP_URL is not set at all", () => {
    vi.stubEnv("PUBLIC_APP_URL", "");
    expect(() => buildAssemblyAiWebhookUrl()).toThrow(/not set/i);
  });
});

describe("getTranscriptionConfigStatus", () => {
  it("reports healthy webhook configuration without leaking secret values", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "super-secret-key");
    vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "super-secret-webhook");
    vi.stubEnv("PUBLIC_APP_URL", "https://studyscribe-ai.vercel.app");

    const status = getTranscriptionConfigStatus();
    expect(status.hasApiKey).toBe(true);
    expect(status.hasWebhookSecret).toBe(true);
    expect(status.mode).toBe("webhook");
    expect(status.publicAppUrlError).toBeNull();

    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("super-secret-webhook");
  });

  it("surfaces a malformed PUBLIC_APP_URL as an actionable error", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "k");
    vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "s");
    vi.stubEnv("PUBLIC_APP_URL", "studyscribe-ai.vercel.app");

    const status = getTranscriptionConfigStatus();
    expect(status.publicAppUrlError).toMatch(/must include the scheme/i);
    expect(status.webhookUrl).toBeNull();
  });

  it("falls back to polling mode when the webhook is not fully configured", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "k");
    vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "");
    vi.stubEnv("PUBLIC_APP_URL", "https://example.com");
    expect(getTranscriptionConfigStatus().mode).toBe("polling");
  });
});
