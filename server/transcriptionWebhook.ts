import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { createTranscript, getRecordingByTranscriptionProviderId, getTranscriptByRecordingId, updateRecordingStatus } from "./db";
import { retrieveSpeakerDiarization, type AssemblyAiWebhookPayload } from "./speakerDiarization";
import { sendBrowserPush } from "./pushNotifications";

export function isValidAssemblyAiWebhookSecret(receivedValue: string | undefined) {
  const expectedValue = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  if (!expectedValue || !receivedValue) return false;
  const expected = Buffer.from(expectedValue);
  const received = Buffer.from(receivedValue);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function isWebhookPayload(value: unknown): value is AssemblyAiWebhookPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.transcript_id === "string" && (payload.status === "completed" || payload.status === "error");
}

export async function handleAssemblyAiWebhook(req: Request, res: Response) {
  const secret = req.header("X-StudyScribe-Webhook-Secret");
  if (!isValidAssemblyAiWebhookSecret(secret)) {
    res.status(401).json({ error: "Invalid webhook authorization" });
    return;
  }
  if (!isWebhookPayload(req.body)) {
    res.status(400).json({ error: "Invalid webhook payload" });
    return;
  }

  const recording = await getRecordingByTranscriptionProviderId(req.body.transcript_id);
  if (!recording) {
    // Returning 2xx stops provider retries for a deleted or safely unknown recording.
    res.status(204).end();
    return;
  }

  if (recording.status === "completed" || recording.status === "failed") {
    res.status(204).end();
    return;
  }

  if (req.body.status === "error") {
    await updateRecordingStatus(recording.id, "failed");
    res.status(204).end();
    return;
  }

  try {
    const transcript = await retrieveSpeakerDiarization(req.body.transcript_id);
    const existingTranscript = await getTranscriptByRecordingId(recording.id);
    if (!existingTranscript) {
      await createTranscript({
        recordingId: recording.id,
        userId: recording.userId,
        fullText: transcript.text,
        segments: transcript.segments,
        language: transcript.language,
      });
    }
    await updateRecordingStatus(recording.id, "completed");

    await sendBrowserPush(recording.userId, {
      title: "Transcript ready",
      body: `“${recording.title}” is ready for review.`,
      url: `/recording/${recording.id}`,
      tag: `transcript-${recording.id}`,
    }).catch(error => console.error("[Transcription] Browser push delivery failed", error));
    res.status(204).end();
  } catch (error) {
    console.error("[Transcription] AssemblyAI webhook processing failed", error);
    // A 500 asks AssemblyAI to retry the transient callback delivery.
    res.status(500).json({ error: "Transcript processing failed" });
  }
}
