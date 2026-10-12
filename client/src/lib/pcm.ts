/**
 * Audio conversion for live transcription: the recorder's Web Audio graph
 * runs at the device rate (usually 48 kHz or 44.1 kHz, float samples), and
 * the streaming service wants 16 kHz mono 16-bit PCM in 50-1000 ms messages.
 *
 * Pure and dependency-free so the AudioWorklet can bundle it, and so the
 * tests can check it without a browser.
 */

/** Float samples in [-1, 1] to little-endian-ready signed 16-bit integers, clamped. */
export function floatToPcm16(samples: ArrayLike<number>): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Averages the channels of one render quantum into a single mono channel. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i] += channel[i] ?? 0;
  }
  for (let i = 0; i < length; i++) out[i] /= channels.length;
  return out;
}

/**
 * A streaming downsampler. Each output sample is the average of the input
 * samples around its position (a box filter), which keeps most aliasing out
 * of speech without a full FIR filter. State carries across calls, so
 * feeding 128-sample render quanta gives the same result as one long buffer.
 */
export function createResampler(inputRate: number, outputRate: number): (input: Float32Array) => Float32Array {
  if (!(inputRate > 0) || !(outputRate > 0)) throw new Error("Sample rates must be positive");
  const ratio = inputRate / outputRate;
  const half = ratio > 1 ? Math.floor(ratio / 2) : 0;
  let pending = new Float32Array(0);
  // Position of the next output sample, in `pending` coordinates.
  let position = 0;

  return (input: Float32Array) => {
    let data: Float32Array;
    if (pending.length === 0) {
      data = input;
    } else {
      data = new Float32Array(pending.length + input.length);
      data.set(pending);
      data.set(input, pending.length);
    }
    const out = new Float32Array(Math.ceil(data.length / ratio) + 1);
    let count = 0;
    for (;;) {
      const center = Math.floor(position);
      const end = center + half;
      if (end >= data.length) break;
      const start = Math.max(0, center - half);
      let sum = 0;
      for (let k = start; k <= end; k++) sum += data[k];
      out[count++] = sum / (end - start + 1);
      position += ratio;
    }
    const keepFrom = Math.max(0, Math.min(data.length, Math.floor(position) - half));
    pending = data.slice(keepFrom);
    position -= keepFrom;
    return out.subarray(0, count);
  };
}

/** Collects samples into fixed-size chunks; returns every chunk completed by this call. */
export function createChunker(chunkSamples: number): { push: (samples: Int16Array) => Int16Array[]; reset: () => void } {
  let current = new Int16Array(chunkSamples);
  let filled = 0;
  return {
    push(samples) {
      const done: Int16Array[] = [];
      let offset = 0;
      while (offset < samples.length) {
        const take = Math.min(chunkSamples - filled, samples.length - offset);
        current.set(samples.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === chunkSamples) {
          done.push(current);
          current = new Int16Array(chunkSamples);
          filled = 0;
        }
      }
      return done;
    },
    reset() {
      current = new Int16Array(chunkSamples);
      filled = 0;
    },
  };
}
