import { setRecordingTranscriptionProviderId, updateRecordingStatus } from "./db";
import { assertSignedAudioUrlIsFetchable, storageGetSignedUrl } from "./storage";
import { buildAssemblyAiWebhookUrl, isAssemblyAiWebhookConfigured, submitTranscriptionJob } from "./speakerDiarization";
import { buildTranscriptionAudioUrl } from "./transcriptionAudioLink";
import { resolveKeyterms } from "./vocabulary";

/**
 * Submits a stored recording's audio to the transcription provider and
 * records the returned job id. Deliberately does only this and returns --
 * it does not itself wait for the result. In webhook mode AssemblyAI calls
 * /api/webhooks/assemblyai back when done; otherwise recordings.getStatus
 * (already polled by the client every 3s) drives completion via
 * advancePollingTranscription below. A submission alone takes a fraction
 * of a second, so unlike the old approach -- submitting AND polling for up
 * to several minutes inside one fire-and-forget call from this mutation --
 * it reliably finishes within the request's own lifecycle regardless of
 * how long transcription ends up taking. That mattered because Vercel does
 * not guarantee unawaited work continues once the HTTP response has been
 * sent, and this function has a 60s maxDuration budget; a poll that
 * outlived it left the recording silently stuck in "processing" forever,
 * with no error and no way to know why.
 */
export async function startTranscription(
  recording: { id: number; userId: number },
  audioKey: string,
  mimeType: string,
  language?: string,
  /** Extra vocabulary given with this request; otherwise the recording's stored terms are used. */
  keyterms?: string[],
): Promise<void> {
  try {
    // Hand the provider a link served by this app rather than the raw
    // storage URL: it ends in a real audio extension and serves the real
    // content type, where the stored object is a generic `.bin`, and it
    // outlives storage's short-lived signed URLs for queued jobs.
    const providerAudioUrl = process.env.PUBLIC_APP_URL
      ? buildTranscriptionAudioUrl(audioKey, mimeType, process.env.PUBLIC_APP_URL)
      : await storageGetSignedUrl(audioKey);
    await assertSignedAudioUrlIsFetchable(providerAudioUrl);

    const webhookUrl = isAssemblyAiWebhookConfigured() ? buildAssemblyAiWebhookUrl() : undefined;
    const vocabulary = await resolveKeyterms(recording.userId, recording.id, keyterms);
    const { providerId } = await submitTranscriptionJob({ audioUrl: providerAudioUrl, webhookUrl, language, keyterms: vocabulary });
    await setRecordingTranscriptionProviderId(recording.id, providerId);
  } catch (error) {
    await updateRecordingStatus(recording.id, "failed");
    throw error;
  }
}
