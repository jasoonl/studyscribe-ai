import { afterEach, describe, expect, it, vi } from "vitest";
import { getLLMProvider } from "./llm";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LLM provider selection", () => {
  it("prefers a project-owned OpenAI key on Vercel", () => {
    vi.stubEnv("OPENAI_API_KEY", "project-owned-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1-mini");
    expect(getLLMProvider()).toMatchObject({ name: "openai", model: "gpt-4.1-mini" });
  });

  it("retains the Manus Forge fallback only where its managed credentials are available", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://forge.example");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "managed-key");
    expect(getLLMProvider()).toMatchObject({ name: "manus-forge", apiKey: "managed-key" });
  });
});
