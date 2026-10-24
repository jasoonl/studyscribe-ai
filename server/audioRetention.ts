/** DELETE_AUDIO_AFTER_TRANSCRIPTION=true removes stored audio once a transcript is saved. Off unless set exactly so. */
export function shouldDeleteAudioAfterTranscription(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DELETE_AUDIO_AFTER_TRANSCRIPTION ?? "").trim().toLowerCase() === "true";
}

export const AUDIO_DELETE_TIMEOUT_MS = 8_000;

type RetentionDeps = {
  deleteAudio: (keys: string[]) => Promise<void>;
  clearAudio: (recordingId: number) => Promise<unknown>;
  enabled: () => boolean;
  timeoutMs: number;
};

async function defaultDeps(): Promise<RetentionDeps> {
  const [{ deleteStoredAudio }, { clearRecordingAudio }] = await Promise.all([import("./storage"), import("./db")]);
  return { deleteAudio: deleteStoredAudio, clearAudio: clearRecordingAudio, enabled: shouldDeleteAudioAfterTranscription, timeoutMs: AUDIO_DELETE_TIMEOUT_MS };
}

/**
 * Deletes a finished recording's audio when DELETE_AUDIO_AFTER_TRANSCRIPTION is on.
 * Best-effort and never throws, so the webhook/finalize path is never blocked or failed:
 * the Blob delete has a timeout, and if blanking the row fails after the file is gone it
 * is retried once and then logged.
 */
export async function removeAudioIfConfigured(recording: { id: number; audioKey: string | null }, overrides: Partial<RetentionDeps> = {}): Promise<void> {
  try {
    const deps = { ...(await defaultDeps().catch(() => ({}) as RetentionDeps)), ...overrides };
    if (!deps.enabled() || !recording.audioKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.deleteAudio([recording.audioKey]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out deleting audio")), deps.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      await deps.clearAudio(recording.id);
    } catch {
      try {
        await deps.clearAudio(recording.id);
      } catch (error) {
        console.warn("[Transcription] audio was deleted but the recording row could not be updated", recording.id, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.warn("[Transcription] could not remove audio after transcription", recording.id, error instanceof Error ? error.message : error);
  }
}
