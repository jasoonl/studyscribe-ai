import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STREAMING_MODEL,
  LIVE_SESSION_SECONDS,
  buildStreamingSocketUrl,
  getLiveAvailability,
  getLiveTranscriptionStatus,
  liveSpeakerLabelsEnabled,
  mintLiveToken,
  resolveStreamingEndpoint,
  resolveStreamingModel,
} from "./liveTranscription";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveStreamingEndpoint", () => {
  it("defaults to AssemblyAI's streaming host", () => {
    expect(resolveStreamingEndpoint("")).toEqual({ httpOrigin: "https://streaming.assemblyai.com", wsOrigin: "wss://streaming.assemblyai.com" });
  });

  it("accepts a data-residency host without a scheme", () => {
    expect(resolveStreamingEndpoint("streaming.eu.assemblyai.com")).toEqual({
      httpOrigin: "https://streaming.eu.assemblyai.com",
      wsOrigin: "wss://streaming.eu.assemblyai.com",
    });
  });

  it("allows plain http only for a local mock server", () => {
    expect(resolveStreamingEndpoint("http://127.0.0.1:7071")).toEqual({ httpOrigin: "http://127.0.0.1:7071", wsOrigin: "ws://127.0.0.1:7071" });
    expect(resolveStreamingEndpoint("http://streaming.assemblyai.com")).toHaveProperty("error");
  });

  it("refuses hosts that are not AssemblyAI's, so the API key is never sent elsewhere", () => {
    expect(resolveStreamingEndpoint("https://example.com")).toHaveProperty("error");
    expect(resolveStreamingEndpoint("https://assemblyai.com.evil.test")).toHaveProperty("error");
  });
});

describe("resolveStreamingModel", () => {
  it("falls back to the default for unknown values", () => {
    expect(resolveStreamingModel("")).toBe(DEFAULT_STREAMING_MODEL);
    expect(resolveStreamingModel("nano")).toBe(DEFAULT_STREAMING_MODEL);
    expect(resolveStreamingModel("universal-3-6-pro")).toBe("universal-3-6-pro");
  });
});

describe("buildStreamingSocketUrl", () => {
  it("asks for 16 kHz PCM16 with formatted turns", () => {
    const url = new URL(buildStreamingSocketUrl("wss://streaming.assemblyai.com", "universal-streaming-english"));
    expect(url.pathname).toBe("/v3/ws");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.get("speech_model")).toBe("universal-streaming-english");
    expect(url.searchParams.get("format_turns")).toBe("true");
    expect(url.searchParams.has("token")).toBe(false);
  });

  it("asks for speaker labels unless they are switched off", () => {
    const on = new URL(buildStreamingSocketUrl("wss://streaming.assemblyai.com", "universal-streaming-english", true));
    expect(on.searchParams.get("speaker_labels")).toBe("true");
    const off = new URL(buildStreamingSocketUrl("wss://streaming.assemblyai.com", "universal-streaming-english", false));
    expect(off.searchParams.has("speaker_labels")).toBe(false);
    expect(liveSpeakerLabelsEnabled(undefined)).toBe(true);
    expect(liveSpeakerLabelsEnabled("off")).toBe(false);
    expect(liveSpeakerLabelsEnabled("OFF ")).toBe(false);
  });
});

describe("availability", () => {
  it("is unavailable without an API key", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    expect(getLiveAvailability()).toMatchObject({ available: false, reason: "no_api_key" });
  });

  it("can be switched off for cost", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    vi.stubEnv("LIVE_TRANSCRIPTION", "off");
    expect(getLiveAvailability()).toMatchObject({ available: false, reason: "disabled" });
  });

  it("reports status for the Admin page without the key", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "super-secret-key");
    vi.stubEnv("LIVE_TRANSCRIPTION", "");
    const status = getLiveTranscriptionStatus();
    expect(status.available).toBe(true);
    expect(status.maxSessionSeconds).toBe(LIVE_SESSION_SECONDS);
    expect(JSON.stringify(status)).not.toContain("super-secret-key");
  });
});

describe("mintLiveToken", () => {
  it("requests a temporary token with the key in the header and returns the socket URL", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "super-secret-key");
    vi.stubEnv("ASSEMBLYAI_STREAMING_HOST", "");
    vi.stubEnv("LIVE_TRANSCRIPTION", "");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: "temp-token", expires_in_seconds: 60 }), { status: 200 }));
    const grant = await mintLiveToken(fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(`https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=${LIVE_SESSION_SECONDS}`);
    expect((init.headers as Record<string, string>).Authorization).toBe("super-secret-key");
    expect(grant.token).toBe("temp-token");
    expect(grant.socketUrl.startsWith("wss://streaming.assemblyai.com/v3/ws?")).toBe(true);
    expect(JSON.stringify(grant)).not.toContain("super-secret-key");
  });

  it("explains a refused key without leaking the provider's response", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "bad");
    vi.stubEnv("LIVE_TRANSCRIPTION", "");
    const fetchImpl = vi.fn(async () => new Response("Invalid API key", { status: 401 }));
    await expect(mintLiveToken(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/refused this server's credentials/);
  });

  it("does not call the provider when unavailable", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    const fetchImpl = vi.fn();
    await expect(mintLiveToken(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/not set up/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
