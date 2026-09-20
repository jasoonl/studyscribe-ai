import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRecordingByTranscriptionProviderId = vi.fn();
const updateRecordingStatus = vi.fn(async () => undefined);
const createTranscript = vi.fn(async () => undefined);
const getTranscriptByRecordingId = vi.fn(async () => null);
const getDb = vi.fn(async () => null);
const retrieveSpeakerDiarization = vi.fn();
const sendBrowserPush = vi.fn(async () => undefined);

vi.mock("./db", () => ({
  getRecordingByTranscriptionProviderId: (...a: unknown[]) => getRecordingByTranscriptionProviderId(...a),
  updateRecordingStatus: (...a: unknown[]) => updateRecordingStatus(...a),
  createTranscript: (...a: unknown[]) => createTranscript(...a),
  getTranscriptByRecordingId: (...a: unknown[]) => getTranscriptByRecordingId(...a),
  getDb: (...a: unknown[]) => getDb(...a),
}));

vi.mock("./speakerDiarization", () => ({
  retrieveSpeakerDiarization: (...a: unknown[]) => retrieveSpeakerDiarization(...a),
}));

vi.mock("./pushNotifications", () => ({
  sendBrowserPush: (...a: unknown[]) => sendBrowserPush(...a),
}));

import { handleAssemblyAiWebhook } from "./transcriptionWebhook";

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    end() { return this; },
  };
  return res;
}

function mockReq(body: unknown) {
  return { body, header: () => process.env.ASSEMBLYAI_WEBHOOK_SECRET } as never;
}

beforeEach(() => {
  process.env.ASSEMBLYAI_WEBHOOK_SECRET = "test-secret";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AssemblyAI webhook delivery", () => {
  it("asks for redelivery when the provider id has not been stored yet", async () => {
    // A short recording can finish and call back before the submission's
    // "save provider id" write lands. Acknowledging with 2xx here stopped the
    // provider retrying and lost the transcript permanently.
    getRecordingByTranscriptionProviderId.mockResolvedValue(null);

    const res = mockRes();
    await handleAssemblyAiWebhook(mockReq({ transcript_id: "t_1", status: "completed" }), res as never);

    expect(res.statusCode).toBe(503);
    expect(updateRecordingStatus).not.toHaveBeenCalled();
  });

  it("stores the transcript once the recording is found", async () => {
    getRecordingByTranscriptionProviderId.mockResolvedValue({
      id: 5, userId: 9, title: "Lecture", status: "processing",
    });
    retrieveSpeakerDiarization.mockResolvedValue({ text: "hello", language: "en", segments: [] });

    const res = mockRes();
    await handleAssemblyAiWebhook(mockReq({ transcript_id: "t_1", status: "completed" }), res as never);

    expect(createTranscript).toHaveBeenCalledWith(expect.objectContaining({ recordingId: 5, fullText: "hello" }));
    expect(updateRecordingStatus).toHaveBeenCalledWith(5, "completed");
    expect(res.statusCode).toBe(204);
  });

  it("stores a transcript that has no speaker segments", async () => {
    getRecordingByTranscriptionProviderId.mockResolvedValue({
      id: 5, userId: 9, title: "Short clip", status: "processing",
    });
    retrieveSpeakerDiarization.mockResolvedValue({ text: "just me talking", language: "en", segments: [] });

    const res = mockRes();
    await handleAssemblyAiWebhook(mockReq({ transcript_id: "t_1", status: "completed" }), res as never);

    expect(createTranscript).toHaveBeenCalled();
    expect(updateRecordingStatus).toHaveBeenCalledWith(5, "completed");
  });

  it("rejects a webhook carrying the wrong secret", async () => {
    const res = mockRes();
    const req = { body: { transcript_id: "t_1", status: "completed" }, header: () => "wrong" } as never;
    await handleAssemblyAiWebhook(req, res as never);
    expect(res.statusCode).toBe(401);
  });

  it("does not reprocess a recording that already completed", async () => {
    getRecordingByTranscriptionProviderId.mockResolvedValue({
      id: 5, userId: 9, title: "Lecture", status: "completed",
    });
    const res = mockRes();
    await handleAssemblyAiWebhook(mockReq({ transcript_id: "t_1", status: "completed" }), res as never);
    expect(createTranscript).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(204);
  });
});
