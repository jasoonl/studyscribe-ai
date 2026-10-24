import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const getRecordingByAudioKey = vi.fn();
const softCap = vi.fn(async () => false);
const hardLimit = vi.fn(async () => false);
const stream = vi.fn(async (_req: unknown, res: any) => {
  res.status(200).send("audio");
});

vi.mock("./db", () => ({ getAppSetting: vi.fn(), getDb: vi.fn(), getRecordingByAudioKey: (...a: unknown[]) => getRecordingByAudioKey(...a) }));
vi.mock("./sessionRevocation", () => ({ revokeSession: vi.fn(), sessionIsValid: vi.fn() }));
vi.mock("./sessionManager", () => ({ createSessionToken: vi.fn(), getBearerToken: vi.fn(), sessionMatchesUser: vi.fn(), verifySessionToken: vi.fn() }));
vi.mock("./_core/rateLimit", () => ({ authLimiter: (_q: unknown, _r: unknown, next: () => void) => next() }));
vi.mock("./_core/storageProxy", () => ({ streamStoredAudio: (...a: [unknown, unknown, string]) => stream(...a) }));
vi.mock("./blobTransfer", () => ({
  TRANSFER_PAUSED_MESSAGE: "paused",
  isTransferSoftCapReached: () => softCap(),
  isTransferLimitReached: () => hardLimit(),
}));
vi.mock("./nativeSocialAuth", () => ({ completeNativeSocialAuth: vi.fn() }));
vi.mock("./nativeIdentity", () => ({ IdentityTokenError: class extends Error {}, verifyAppleIdentityToken: vi.fn(), verifyGoogleIdToken: vi.fn() }));
vi.mock("./nativePush", () => ({ unregisterDeviceToken: vi.fn() }));
vi.mock("./playbackLink", () => ({ verifyPlaybackToken: () => ({ key: "7/recordings/a.bin", userId: 7, recordingId: 1 }) }));

const { registerMobileRoutes } = await import("./mobileAuth");

async function get() {
  const app = express();
  registerMobileRoutes(app);
  const server = app.listen(0);
  const address = server.address() as { port: number };
  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/storage/playback/tok/a.aac`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  softCap.mockResolvedValue(false);
  hardLimit.mockResolvedValue(false);
  getRecordingByAudioKey.mockResolvedValue({ id: 1, userId: 7 });
});

describe("mobile playback soft cap", () => {
  it("lets the owner play at the soft cap", async () => {
    softCap.mockResolvedValue(true);
    expect((await get()).status).toBe(200);
  });
  it("refuses a recipient (not the owner) at the soft cap with 503", async () => {
    softCap.mockResolvedValue(true);
    getRecordingByAudioKey.mockResolvedValue({ id: 1, userId: 99 });
    const res = await get();
    expect(res.status).toBe(503);
    expect(stream).not.toHaveBeenCalled();
  });
  it("refuses even the owner at the hard limit", async () => {
    hardLimit.mockResolvedValue(true);
    expect((await get()).status).toBe(503);
  });
});
