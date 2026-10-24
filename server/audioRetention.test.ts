import { describe, expect, it } from "vitest";
import { shouldDeleteAudioAfterTranscription } from "./audioRetention";

describe("shouldDeleteAudioAfterTranscription", () => {
  it("is off unless set to true", () => {
    expect(shouldDeleteAudioAfterTranscription({})).toBe(false);
    expect(shouldDeleteAudioAfterTranscription({ DELETE_AUDIO_AFTER_TRANSCRIPTION: "1" } as any)).toBe(false);
    expect(shouldDeleteAudioAfterTranscription({ DELETE_AUDIO_AFTER_TRANSCRIPTION: " True " } as any)).toBe(true);
  });
});

import { vi } from "vitest";
import { removeAudioIfConfigured } from "./audioRetention";

describe("removeAudioIfConfigured", () => {
  const rec = { id: 5, audioKey: "7/recordings/a.bin" };
  const base = () => ({ deleteAudio: vi.fn(async () => undefined), clearAudio: vi.fn(async () => undefined), enabled: () => true, timeoutMs: 20 });

  it("does nothing when disabled or there is no audio", async () => {
    const d = { ...base(), enabled: () => false };
    await removeAudioIfConfigured(rec, d);
    await removeAudioIfConfigured({ id: 1, audioKey: "" }, base());
    expect(d.deleteAudio).not.toHaveBeenCalled();
  });
  it("deletes the file then blanks the row", async () => {
    const d = base();
    await removeAudioIfConfigured(rec, d);
    expect(d.deleteAudio).toHaveBeenCalledWith([rec.audioKey]);
    expect(d.clearAudio).toHaveBeenCalledWith(5);
  });
  it("gives up on a hung delete without throwing and keeps the row", async () => {
    const d = { ...base(), deleteAudio: vi.fn(() => new Promise<void>(() => undefined)) };
    await expect(removeAudioIfConfigured(rec, d)).resolves.toBeUndefined();
    expect(d.clearAudio).not.toHaveBeenCalled();
  });
  it("does not throw when the delete fails", async () => {
    const d = { ...base(), deleteAudio: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(removeAudioIfConfigured(rec, d)).resolves.toBeUndefined();
    expect(d.clearAudio).not.toHaveBeenCalled();
  });
  it("retries the row update once after a successful delete, then logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const d = { ...base(), clearAudio: vi.fn(async () => { throw new Error("db"); }) };
    await expect(removeAudioIfConfigured(rec, d)).resolves.toBeUndefined();
    expect(d.clearAudio).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("succeeds when the retry works", async () => {
    let n = 0;
    const d = { ...base(), clearAudio: vi.fn(async () => { if (n++ === 0) throw new Error("db"); }) };
    await removeAudioIfConfigured(rec, d);
    expect(d.clearAudio).toHaveBeenCalledTimes(2);
  });
});
