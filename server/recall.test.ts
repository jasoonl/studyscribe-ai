import { describe, expect, it } from "vitest";
import {
  buildCreateBotBody,
  getRecallConfig,
  isAllowedMediaUrl,
  joinMessage,
  mediaDownloadUrl,
  meetingPlatform,
  noteTakerName,
  parseRecallEvent,
  shouldApplyStatus,
  signRecallPayload,
  statusFromRecallCode,
  verifyRecallSignature,
} from "./recall";

const SECRET = `whsec_${Buffer.from("a-very-secret-recall-signing-key").toString("base64")}`;
const NOW = 1_800_000_000;

function headers(body: string, { id = "msg_1", timestamp = NOW, secret = SECRET, prefix = "webhook" } = {}) {
  return {
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: String(timestamp),
    [`${prefix}-signature`]: signRecallPayload(id, timestamp, body, secret),
  };
}

describe("Recall webhook signatures", () => {
  const body = JSON.stringify({ event: "bot.done", data: { bot: { id: "bot_1" }, data: { code: "done" } } });

  it("accepts a correctly signed delivery (webhook-* and svix-* headers)", () => {
    expect(verifyRecallSignature(body, headers(body), SECRET, NOW)).toEqual({ ok: true });
    expect(verifyRecallSignature(Buffer.from(body), headers(body, { prefix: "svix" }), SECRET, NOW)).toEqual({ ok: true });
  });

  it("accepts any of several space-separated signatures (secret rotation)", () => {
    const h = headers(body);
    h["webhook-signature"] = `v1,AAAA ${h["webhook-signature"]}`;
    expect(verifyRecallSignature(body, h, SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects a changed body, a wrong secret, a stale timestamp and missing headers", () => {
    expect(verifyRecallSignature(body.replace("done", "fatal"), headers(body), SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyRecallSignature(body, headers(body, { secret: `whsec_${Buffer.from("other").toString("base64")}` }), SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyRecallSignature(body, headers(body, { timestamp: NOW - 600 }), SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(verifyRecallSignature(body, {}, SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it("binds the signature to the message id", () => {
    const h = headers(body);
    h["webhook-id"] = "msg_2";
    expect(verifyRecallSignature(body, h, SECRET, NOW)).toMatchObject({ ok: false });
  });
});

describe("configuration", () => {
  it("needs the key, a valid region and the webhook secret", () => {
    expect(getRecallConfig({ RECALL_API_KEY: "k", RECALL_REGION: "us-west-2" } as any)).toBeNull();
    expect(getRecallConfig({ RECALL_API_KEY: "k", RECALL_REGION: "nowhere", RECALL_WEBHOOK_SECRET: "s" } as any)).toBeNull();
    expect(getRecallConfig({ RECALL_API_KEY: "k", RECALL_REGION: "eu-central-1", RECALL_WEBHOOK_SECRET: "s" } as any)?.apiBase).toBe("https://eu-central-1.recall.ai/api/v1");
  });

  it("ignores the test API base in production", () => {
    const env = { RECALL_API_KEY: "k", RECALL_REGION: "us-west-2", RECALL_WEBHOOK_SECRET: "s", RECALL_API_BASE: "http://127.0.0.1:9/api/v1" };
    expect(getRecallConfig({ ...env, NODE_ENV: "production" } as any)?.apiBase).toBe("https://us-west-2.recall.ai/api/v1");
    expect(getRecallConfig({ ...env, NODE_ENV: "development" } as any)?.apiBase).toBe("http://127.0.0.1:9/api/v1");
  });
});

describe("meeting links", () => {
  it("recognises Zoom, Meet and Teams links only over https on their own hosts", () => {
    expect(meetingPlatform("https://us02web.zoom.us/j/81234567890?pwd=abc")).toBe("zoom");
    expect(meetingPlatform("https://meet.google.com/abc-defg-hij")).toBe("google_meet");
    expect(meetingPlatform("https://teams.microsoft.com/l/meetup-join/19%3ameeting")).toBe("teams");
    expect(meetingPlatform("http://meet.google.com/abc-defg-hij")).toBeNull();
    expect(meetingPlatform("https://meet.google.com.evil.example/abc-defg-hij")).toBeNull();
    expect(meetingPlatform("https://example.com/j/123")).toBeNull();
    expect(meetingPlatform("not a link")).toBeNull();
  });
});

describe("consent", () => {
  it("names the bot as recording and announces it in the chat", () => {
    expect(noteTakerName("Ana Lopez")).toBe("StudyScribe note-taker (recording for Ana)");
    expect(noteTakerName(null)).toMatch(/recording/);
    expect(joinMessage("Ana Lopez")).toMatch(/record this meeting/);
    const body = buildCreateBotBody({ meetingUrl: "https://meet.google.com/abc-defg-hij", botName: noteTakerName("Ana"), personName: "Ana", joinAt: null, botRowId: 4, userId: 1 });
    expect(body.bot_name).toMatch(/recording/);
    expect(body.chat.on_bot_join.message).toMatch(/record/);
    expect(body.recording_config).toEqual({ audio_mixed_mp3: {} });
    expect(body).not.toHaveProperty("join_at");
    expect(body.metadata).toEqual({ studyscribe_bot: "4", studyscribe_user: "1" });
  });
});

describe("bot status", () => {
  it("maps Recall's codes", () => {
    expect(statusFromRecallCode("in_call_recording")?.status).toBe("recording");
    expect(statusFromRecallCode("recording_permission_denied")?.status).toBe("failed");
    expect(statusFromRecallCode("done")?.status).toBe("done");
    expect(statusFromRecallCode("something_new")).toBeNull();
  });

  it("never moves backwards or changes a finished bot", () => {
    expect(shouldApplyStatus("joining", "recording")).toBe(true);
    expect(shouldApplyStatus("recording", "joining")).toBe(false);
    expect(shouldApplyStatus("ended", "done")).toBe(true);
    expect(shouldApplyStatus("imported", "done")).toBe(false);
    expect(shouldApplyStatus("importing", "done")).toBe(false);
    expect(shouldApplyStatus("recording", "failed")).toBe(true);
    expect(shouldApplyStatus("cancelled", "recording")).toBe(false);
  });

  it("reads webhook bodies in both shapes", () => {
    expect(parseRecallEvent({ event: "bot.status_change", data: { bot: { id: "b1" }, data: { code: "in_call_recording", updated_at: "2026-10-13T10:00:00Z" } } })).toEqual({ botId: "b1", code: "in_call_recording", at: Date.parse("2026-10-13T10:00:00Z") / 1000 });
    expect(parseRecallEvent({ event: "bot.done", data: { bot: { id: "b1" }, data: {} } })).toMatchObject({ botId: "b1", code: "done" });
    expect(parseRecallEvent({ event: "transcript.data", data: {} })).toBeNull();
  });

  it("finds the audio and only trusts Recall's storage", () => {
    const config = getRecallConfig({ RECALL_API_KEY: "k", RECALL_REGION: "us-west-2", RECALL_WEBHOOK_SECRET: "s", NODE_ENV: "production" } as any)!;
    const bot = { recordings: [{ media_shortcuts: { audio_mixed: { data: { download_url: "https://us-west-2-recallai-production-bot-data.s3.amazonaws.com/x.mp3" } } } }] };
    expect(mediaDownloadUrl(bot)).toContain("amazonaws.com");
    expect(mediaDownloadUrl({ recordings: [] })).toBeNull();
    expect(isAllowedMediaUrl("https://bucket.s3.amazonaws.com/a.mp3", config, { NODE_ENV: "production" } as any)).toBe(true);
    expect(isAllowedMediaUrl("http://bucket.s3.amazonaws.com/a.mp3", config, { NODE_ENV: "production" } as any)).toBe(false);
    expect(isAllowedMediaUrl("https://169.254.169.254/latest", config, { NODE_ENV: "production" } as any)).toBe(false);
  });
});
