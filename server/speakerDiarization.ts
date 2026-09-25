const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2";

type AssemblyAiWord = {
  text: string;
  start: number;
  end: number;
  confidence?: number;
};

type AssemblyAiUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  words?: AssemblyAiWord[];
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

// A lecture is usually one speaker, and the provider returns one utterance per
// speaker turn, so a 40-minute monologue arrives as a single "segment" and the
// click-a-timestamp-to-seek transcript becomes one unusable block. Long turns
// are split at sentence ends using the per-word timings the provider includes.
const TARGET_SEGMENT_MS = 15_000;
const MAX_SEGMENT_MS = 40_000;
const SPLIT_ABOVE_MS = 30_000;
// A long stretch with no words (music, silence, an ad break) inside one
// speaker's turn must not be absorbed into a segment: one real recording
// produced a single 752-second "segment" holding a handful of words.
const GAP_SPLIT_MS = 6_000;

function splitLongUtterance(utterance: AssemblyAiUtterance): Array<Omit<SpeakerSegment, "id">> {
  const words = utterance.words ?? [];
  const whole = {
    start: utterance.start / 1_000,
    end: utterance.end / 1_000,
    text: utterance.text.trim(),
    speaker: utterance.speaker ? `Speaker ${utterance.speaker}` : undefined,
    confidence: utterance.confidence,
  };
  if (words.length === 0 || utterance.end - utterance.start <= SPLIT_ABOVE_MS) return [whole];

  const pieces: Array<Omit<SpeakerSegment, "id">> = [];
  let chunk: AssemblyAiWord[] = [];
  const flush = () => {
    if (chunk.length === 0) return;
    const scored = chunk.map((word) => word.confidence).filter((value): value is number => typeof value === "number");
    pieces.push({
      ...whole,
      start: chunk[0].start / 1_000,
      end: chunk[chunk.length - 1].end / 1_000,
      text: chunk.map((word) => word.text).join(" ").trim(),
      confidence: scored.length ? scored.reduce((sum, value) => sum + value, 0) / scored.length : whole.confidence,
    });
    chunk = [];
  };

  for (const word of words) {
    if (chunk.length > 0 && word.start - chunk[chunk.length - 1].end > GAP_SPLIT_MS) flush();
    chunk.push(word);
    const length = word.end - chunk[0].start;
    const endsSentence = /[.!?]["')\]]*$/.test(word.text);
    if ((endsSentence && length >= TARGET_SEGMENT_MS) || length >= MAX_SEGMENT_MS) flush();
  }
  flush();
  return pieces.filter((piece) => piece.text.length > 0);
}

export function normalizeDiarizedSegments(utterances: AssemblyAiUtterance[]): SpeakerSegment[] {
  return utterances
    .filter((utterance) => utterance.text.trim().length > 0)
    .flatMap(splitLongUtterance)
    .map((segment, index) => ({ id: `speaker-${index + 1}`, ...segment }));
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

/**
 * Submits a transcription job and returns immediately with its provider id.
 * Used by both the webhook path (AssemblyAI calls back when done) and the
 * polling fallback (the client drives repeated short status checks — see
 * checkTranscriptionStatus). Deliberately does not itself wait for
 * completion: earlier, transcribeWithSpeakerDiarization submitted AND
 * polled — sometimes for minutes — inside one fire-and-forget call from a
 * tRPC mutation. Vercel does not guarantee unawaited work continues once
 * the HTTP response has been sent, and this function has a 60s maxDuration
 * budget; a poll that outlived it left the recording silently stuck in
 * "processing" forever, with no error and no way to know why. A submission
 * alone takes a fraction of a second, so it reliably completes within the
 * mutation's own request lifecycle regardless of how long transcription
 * itself ends up taking.
 */
export async function submitTranscriptionJob(input: {
  audioUrl: string;
  webhookUrl?: string;
  /** Explicit spoken language; omitted means the provider detects it. */
  language?: string;
}): Promise<{ providerId: string }> {
  const submit = async (withSpeakerLabels: boolean) => {
    const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: input.audioUrl,
        ...(input.language ? { language_code: input.language } : { language_detection: true }),
        ...(withSpeakerLabels ? { speaker_labels: true } : {}),
        ...(input.webhookUrl
          ? {
              webhook_url: input.webhookUrl,
              webhook_auth_header_name: "X-StudyScribe-Webhook-Secret",
              webhook_auth_header_value: process.env.ASSEMBLYAI_WEBHOOK_SECRET,
            }
          : {}),
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

export const NO_SPEECH_ERROR = "No speech was detected in this recording.";

export type TranscriptionStatusResult =
  | { status: "processing" }
  | { status: "completed"; text: string; language: string; segments: SpeakerSegment[] }
  | { status: "error"; error: string };

/**
 * Non-throwing status peek, safe to call from a short-lived request (a
 * client-driven poll) as often as needed — "still processing" is a normal
 * result, not a failure. This is what actually resolves a polling-mode
 * transcription now: see recordings.getStatus, which calls this once per
 * client refetch instead of one server function trying to wait out the
 * whole job itself.
 */
export async function checkTranscriptionStatus(providerId: string): Promise<TranscriptionStatusResult> {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${providerId}`, { headers: getHeaders() });
  const result = await readJson(response);
  if (!response.ok) throw new Error(`Speaker diarization result check failed with ${response.status}`);

  if (result.status === "error") {
    // With language detection on, silent or music-only audio errors out with
    // this provider-worded message rather than completing empty. Same situation,
    // so report it the same way.
    if (/no spoken audio/i.test(result.error ?? "")) return { status: "error", error: NO_SPEECH_ERROR };
    return { status: "error", error: result.error || "Speaker diarization provider could not transcribe this recording" };
  }
  if (result.status === "completed") {
    // A finished job with no text (silence, music, unintelligible audio) used to
    // fall through to "processing" below, leaving the recording spinning forever.
    if (!result.text?.trim()) {
      return { status: "error", error: NO_SPEECH_ERROR };
    }
    // Speaker labels are a bonus, not a requirement — see normalizeDiarizedSegments callers.
    return {
      status: "completed",
      text: result.text,
      language: result.language_code ?? "en",
      segments: normalizeDiarizedSegments(result.utterances ?? []),
    };
  }
  return { status: "processing" };
}

export async function retrieveSpeakerDiarization(providerId: string) {
  const result = await checkTranscriptionStatus(providerId);
  if (result.status === "error") throw new Error(result.error);
  if (result.status === "processing") throw new Error("Speaker diarization result is not ready");
  return { text: result.text, language: result.language, segments: result.segments };
}
