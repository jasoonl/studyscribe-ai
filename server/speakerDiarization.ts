const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 12 * 60 * 1_000;

type AssemblyAiUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
};

type AssemblyAiTranscript = {
  id?: string;
  status?: "queued" | "processing" | "completed" | "error";
  error?: string;
  text?: string;
  language_code?: string;
  utterances?: AssemblyAiUtterance[];
};

export type AssemblyAiWebhookPayload = {
  transcript_id: string;
  status: "completed" | "error";
};

export type SpeakerSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
};

export function isSpeakerDiarizationConfigured() {
  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}

export function isAssemblyAiWebhookConfigured() {
  return Boolean(process.env.ASSEMBLYAI_API_KEY && process.env.ASSEMBLYAI_WEBHOOK_SECRET && process.env.PUBLIC_APP_URL);
}

/**
 * Builds the callback URL AssemblyAI posts the finished transcript to.
 * PUBLIC_APP_URL missing its scheme (`example.com` rather than
 * `https://example.com`) throws a bare "Invalid URL" from the URL parser,
 * which surfaced only as an unexplained failed transcript.
 */
export function buildAssemblyAiWebhookUrl(): string {
  const base = process.env.PUBLIC_APP_URL;
  if (!base) {
    throw new Error("PUBLIC_APP_URL is not set, so the transcription provider has nowhere to send results.");
  }
  try {
    return new URL("/api/webhooks/assemblyai", base).toString();
  } catch {
    throw new Error(
      `PUBLIC_APP_URL is not a valid absolute URL ("${base}"). It must include the scheme, e.g. https://your-app.vercel.app`,
    );
  }
}

/** Reports provider configuration health without exposing any secret values. */
export function getTranscriptionConfigStatus() {
  const base = process.env.PUBLIC_APP_URL;
  let webhookUrl: string | null = null;
  let publicAppUrlError: string | null = null;
  try {
    webhookUrl = buildAssemblyAiWebhookUrl();
  } catch (error) {
    publicAppUrlError = error instanceof Error ? error.message : "unknown error";
  }

  return {
    hasApiKey: Boolean(process.env.ASSEMBLYAI_API_KEY),
    hasWebhookSecret: Boolean(process.env.ASSEMBLYAI_WEBHOOK_SECRET),
    publicAppUrl: base ?? null,
    webhookUrl,
    publicAppUrlError,
    mode: isAssemblyAiWebhookConfigured() ? ("webhook" as const) : ("polling" as const),
  };
}

export function normalizeDiarizedSegments(utterances: AssemblyAiUtterance[]): SpeakerSegment[] {
  return utterances
    .filter((utterance) => utterance.text.trim().length > 0)
    .map((utterance, index) => ({
      id: `speaker-${index + 1}`,
      start: utterance.start / 1_000,
      end: utterance.end / 1_000,
      text: utterance.text.trim(),
      speaker: utterance.speaker ? `Speaker ${utterance.speaker}` : undefined,
      confidence: utterance.confidence,
    }));
}

function getHeaders() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("Speaker diarization is not configured");
  return { Authorization: apiKey };
}

async function readJson(response: Response): Promise<AssemblyAiTranscript> {
  try {
    return (await response.json()) as AssemblyAiTranscript;
  } catch {
    return {};
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function transcribeWithSpeakerDiarization(input: { audioUrl: string }) {
  const createResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: input.audioUrl, language_detection: true, speaker_labels: true }),
  });
  const created = await readJson(createResponse);
  if (!createResponse.ok || !created.id) {
    throw new Error(`Speaker diarization request failed with ${createResponse.status}`);
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const resultResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${created.id}`, { headers: getHeaders() });
    const result = await readJson(resultResponse);
    if (!resultResponse.ok) throw new Error(`Speaker diarization result check failed with ${resultResponse.status}`);
    if (result.status === "completed" && result.text) {
      // Speaker labels are a bonus, not a requirement. Short clips, single
      // speakers, and languages without diarization support all return a
      // perfectly good transcript with no utterances — discarding that and
      // failing the recording loses work the user already paid for.
      return {
        text: result.text,
        language: result.language_code ?? "en",
        segments: normalizeDiarizedSegments(result.utterances ?? []),
      };
    }
    if (result.status === "error") throw new Error(result.error || "Speaker diarization provider could not transcribe this recording");
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error("Speaker diarization timed out while processing this recording");
}

export async function submitSpeakerDiarization(input: { audioUrl: string; webhookUrl: string }) {
  if (!isAssemblyAiWebhookConfigured()) {
    throw new Error("AssemblyAI webhook transcription is not configured");
  }

  const submit = async (withSpeakerLabels: boolean) => {
    const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: input.audioUrl,
        language_detection: true,
        ...(withSpeakerLabels ? { speaker_labels: true } : {}),
        webhook_url: input.webhookUrl,
        webhook_auth_header_name: "X-StudyScribe-Webhook-Secret",
        webhook_auth_header_value: process.env.ASSEMBLYAI_WEBHOOK_SECRET,
      }),
    });
    return { response, body: await readJson(response) };
  };

  let { response, body } = await submit(true);

  // Speaker labels aren't supported for every detected language, and the
  // provider rejects the whole request when they clash. A transcript without
  // speaker labels beats no transcript, so retry once without them.
  if (!response.ok && response.status === 400) {
    console.warn(`[Transcription] Retrying without speaker labels: ${body.error ?? response.status}`);
    ({ response, body } = await submit(false));
  }

  if (!response.ok || !body.id) {
    // The response body carries the actual reason; dropping it was why these
    // failures were unexplainable.
    throw new Error(
      `Transcription provider rejected the request (${response.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  return { providerId: body.id };
}

export async function retrieveSpeakerDiarization(providerId: string) {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${providerId}`, { headers: getHeaders() });
  const result = await readJson(response);
  if (!response.ok) throw new Error(`Speaker diarization result check failed with ${response.status}`);
  if (result.status === "error") throw new Error(result.error || "Speaker diarization provider could not transcribe this recording");
  if (result.status !== "completed" || !result.text) throw new Error("Speaker diarization result is not ready");

  // As above: a transcript without speaker labels is still a transcript.
  return {
    text: result.text,
    language: result.language_code ?? "en",
    segments: normalizeDiarizedSegments(result.utterances ?? []),
  };
}
