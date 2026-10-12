/** Audio format the browser streams to the live transcription service: 16 kHz mono PCM16. */
export const LIVE_SAMPLE_RATE = 16_000;
/** Samples per streamed chunk (100 ms). The service accepts 50-1000 ms per message. */
export const LIVE_CHUNK_SAMPLES = 1_600;
