/**
 * AudioWorklet that turns the recorder's mixed audio into 16 kHz PCM16 chunks
 * for live transcription and posts them to the main thread (transferred, not
 * copied). It only listens: it has no outputs, so nothing it does can reach
 * the MediaRecorder's stream.
 *
 * Loaded with `audioWorklet.addModule` from a `?worker&url` import so Vite
 * bundles `pcm.ts` into it.
 */
import { LIVE_CHUNK_SAMPLES, LIVE_SAMPLE_RATE } from "../../../shared/liveTranscription";
import { createChunker, createResampler, floatToPcm16, mixToMono } from "./pcm";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new (options?: unknown) => AudioWorkletProcessor): void;

class Pcm16Processor extends AudioWorkletProcessor {
  private resample = createResampler(sampleRate, LIVE_SAMPLE_RATE);
  private chunker = createChunker(LIVE_CHUNK_SAMPLES);

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;
    const pcm = floatToPcm16(this.resample(mixToMono(channels)));
    for (const chunk of this.chunker.push(pcm)) {
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor("studyscribe-pcm16", Pcm16Processor);
