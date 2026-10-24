/**
 * Speech-grade bitrate for the browser recorder. MediaRecorder with no
 * bitrate picks the browser's default (often 128 kbps or more for Opus), which
 * is four times what lecture speech needs: AssemblyAI is accurate on 32-64 kbps
 * Opus/AAC, and smaller files mean less upload, storage and playback transfer.
 */
export const RECORDER_AUDIO_BITS_PER_SECOND = 48_000;

export function buildRecorderOptions(mimeType: string): MediaRecorderOptions {
  return { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND };
}
