import { describe, expect, it } from "vitest";
import { createChunker, createResampler, floatToPcm16, mixToMono } from "./pcm";

function sine(frequency: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
  return out;
}

function feedInQuanta(resample: (input: Float32Array) => Float32Array, input: Float32Array, quantum = 128): Float32Array {
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += quantum) parts.push(resample(input.subarray(i, i + quantum)));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("floatToPcm16", () => {
  it("maps the float range onto 16-bit integers and clamps overs", () => {
    expect(Array.from(floatToPcm16([0, 1, -1, 0.5, 2, -3, Number.NaN]))).toEqual([0, 32767, -32768, 16384, 32767, -32768, 0]);
  });
});

describe("mixToMono", () => {
  it("averages channels", () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });

  it("passes a single channel through", () => {
    const channel = new Float32Array([0.25]);
    expect(mixToMono([channel])).toBe(channel);
  });
});

describe("createResampler", () => {
  it.each([48_000, 44_100, 32_000, 16_000])("turns one second at %i Hz into one second at 16 kHz", rate => {
    const out = feedInQuanta(createResampler(rate, 16_000), sine(440, rate, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(2);
  });

  it("gives the same result in render quanta as in one buffer", () => {
    const input = sine(300, 48_000, 0.5);
    const whole = createResampler(48_000, 16_000)(input);
    const pieces = feedInQuanta(createResampler(48_000, 16_000), input);
    expect(pieces.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(pieces[i]).toBeCloseTo(whole[i], 6);
  });

  it("keeps a speech-band tone's shape", () => {
    const out = feedInQuanta(createResampler(48_000, 16_000), sine(440, 48_000, 1, 0.8));
    const expected = sine(440, 16_000, 1, 0.8);
    // Compare away from the start, where the filter window is still filling.
    let maxError = 0;
    for (let i = 100; i < Math.min(out.length, expected.length) - 1; i++) maxError = Math.max(maxError, Math.abs(out[i] - expected[i]));
    expect(maxError).toBeLessThan(0.05);
  });

  it("attenuates a tone above the new Nyquist limit", () => {
    const out = feedInQuanta(createResampler(48_000, 16_000), sine(15_000, 48_000, 0.5, 0.8));
    const peak = Math.max(...Array.from(out.subarray(50)).map(Math.abs));
    expect(peak).toBeLessThan(0.4);
  });
});

describe("createChunker", () => {
  it("emits fixed-size chunks and carries the remainder", () => {
    const chunker = createChunker(4);
    expect(chunker.push(new Int16Array([1, 2, 3]))).toEqual([]);
    const chunks = chunker.push(new Int16Array([4, 5, 6, 7, 8, 9]));
    expect(chunks.map(chunk => Array.from(chunk))).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(chunker.push(new Int16Array([10, 11, 12])).map(chunk => Array.from(chunk))).toEqual([[9, 10, 11, 12]]);
  });

  it("returns independent buffers so they can be transferred", () => {
    const chunker = createChunker(2);
    const [a, b] = chunker.push(new Int16Array([1, 2, 3, 4]));
    expect(a.buffer).not.toBe(b.buffer);
  });
});
