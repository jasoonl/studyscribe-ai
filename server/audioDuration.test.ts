import { describe, expect, it } from "vitest";
import { probeAudioDuration } from "./audioDuration";

function wavBuffer(seconds: number, sampleRate = 8000): Buffer {
  const n = sampleRate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function streamFrom(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

describe("probeAudioDuration", () => {
  it("reads the exact duration from a well-formed WAV header", async () => {
    const wav = wavBuffer(7);
    const duration = await probeAudioDuration(streamFrom(wav), "audio/wav", wav.length);
    expect(duration).toBe(7);
  });

  it("rounds a non-integer duration to whole seconds", async () => {
    const wav = wavBuffer(3);
    // Truncate slightly so the computed duration isn't a clean integer.
    const trimmed = wav.subarray(0, wav.length - 500);
    const duration = await probeAudioDuration(streamFrom(trimmed), "audio/wav", trimmed.length);
    expect(duration).not.toBeNull();
    expect(Number.isInteger(duration)).toBe(true);
  });

  it("returns null for unparseable data instead of throwing", async () => {
    const garbage = Buffer.from("this is not an audio file at all, just text");
    const duration = await probeAudioDuration(streamFrom(garbage), "audio/mpeg", garbage.length);
    expect(duration).toBeNull();
  });

  it("returns null for an empty stream rather than hanging or throwing", async () => {
    const duration = await probeAudioDuration(streamFrom(Buffer.alloc(0)), "audio/wav", 0);
    expect(duration).toBeNull();
  });

  it("never throws even when the stream itself errors", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("network dropped"));
      },
    });
    await expect(probeAudioDuration(failing, "audio/wav", 1000)).resolves.toBeNull();
  });
});
