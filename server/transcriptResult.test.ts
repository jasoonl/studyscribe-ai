import { afterEach, describe, expect, it, vi } from "vitest";

const originalKey = process.env.ASSEMBLYAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.ASSEMBLYAI_API_KEY;
  else process.env.ASSEMBLYAI_API_KEY = originalKey;
});

import { retrieveSpeakerDiarization, submitTranscriptionJob, checkTranscriptionStatus } from "./speakerDiarization";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("retrieveSpeakerDiarization", () => {
  it("keeps a completed transcript that has no speaker-labeled utterances", async () => {
    // Short clips, single speakers and languages without diarization support
    // all complete with text but no utterances. Failing here threw away a
    // transcript the user had already waited (and paid) for.
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ status: "completed", text: "hello world", language_code: "en", utterances: [] }),
    ));

    const result = await retrieveSpeakerDiarization("transcript_1");
    expect(result.text).toBe("hello world");
    expect(result.segments).toEqual([]);
  });

  it("returns speaker segments when the provider does supply them", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({
        status: "completed",
        text: "hi there",
        language_code: "en",
        utterances: [{ speaker: "A", text: "hi", start: 0, end: 1000 }],
      }),
    ));

    const result = await retrieveSpeakerDiarization("transcript_1");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe("Speaker A");
  });

  it("still surfaces a genuine provider error", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ status: "error", error: "Download error: file not found" }),
    ));
    await expect(retrieveSpeakerDiarization("transcript_1")).rejects.toThrow(/Download error/);
  });
});

describe("submitTranscriptionJob", () => {
  it("includes the provider's explanation instead of only a status code", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    process.env.ASSEMBLYAI_WEBHOOK_SECRET = "s";
    process.env.PUBLIC_APP_URL = "https://app.example";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "Invalid audio_url" }, 422),
    ));

    await expect(
      submitTranscriptionJob({ audioUrl: "https://app.example/a.mp3", webhookUrl: "https://app.example/hook" }),
    ).rejects.toThrow(/Invalid audio_url/);
  });

  it("retries without speaker labels when the provider rejects them", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    process.env.ASSEMBLYAI_WEBHOOK_SECRET = "s";
    process.env.PUBLIC_APP_URL = "https://app.example";

    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return bodies.length === 1
        ? jsonResponse({ error: "speaker_labels is not available for this language" }, 400)
        : jsonResponse({ id: "transcript_ok" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTranscriptionJob({
      audioUrl: "https://app.example/a.mp3",
      webhookUrl: "https://app.example/hook",
    });

    expect(result.providerId).toBe("transcript_ok");
    expect(JSON.parse(bodies[0]).speaker_labels).toBe(true);
    expect(JSON.parse(bodies[1]).speaker_labels).toBeUndefined();
  });

  it("submits without any webhook fields when no webhookUrl is given (polling mode)", async () => {
    // This is what recordings.getStatus's client-driven polling relies on:
    // submission must return fast on its own, with no webhook wiring at all,
    // rather than the old approach of submitting AND waiting out the whole
    // job inside one call.
    process.env.ASSEMBLYAI_API_KEY = "k";
    let sentBody: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse({ id: "transcript_polling" });
    }));

    const result = await submitTranscriptionJob({ audioUrl: "https://app.example/a.mp3" });

    expect(result.providerId).toBe("transcript_polling");
    expect(sentBody.webhook_url).toBeUndefined();
    expect(sentBody.webhook_auth_header_value).toBeUndefined();
  });
});

describe("checkTranscriptionStatus", () => {
  it("reports 'processing' without throwing while the job is still running", async () => {
    // The old retrieveSpeakerDiarization threw for this exact case, which
    // meant every "not done yet" check looked identical to a real failure.
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "processing" })));
    await expect(checkTranscriptionStatus("transcript_1")).resolves.toEqual({ status: "processing" });
  });

  it("reports 'completed' with the transcript once the job finishes", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ status: "completed", text: "done talking", language_code: "en", utterances: [] }),
    ));
    const result = await checkTranscriptionStatus("transcript_1");
    expect(result).toMatchObject({ status: "completed", text: "done talking" });
  });

  it("reports 'error' with the provider's reason rather than throwing", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ status: "error", error: "Download error: file not found" }),
    ));
    const result = await checkTranscriptionStatus("transcript_1");
    expect(result).toEqual({ status: "error", error: "Download error: file not found" });
  });

  it("still throws for a genuine transport failure, distinct from a normal in-progress result", async () => {
    process.env.ASSEMBLYAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(checkTranscriptionStatus("transcript_1")).rejects.toThrow(/result check failed/);
  });
});
