import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { createTranscript, getDb, getRecordingByTranscriptionProviderId, getTranscriptByRecordingId, updateRecordingStatus } from "./db";
import { NO_SPEECH_ERROR, retrieveSpeakerDiarization, type AssemblyAiWebhookPayload } from "./speakerDiarization";
import { sendBrowserPush } from "./pushNotifications";
import { userNotifications } from "../drizzle/schema";

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

async function failRecording(recording: { id: number; userId: number; title: string }, reason: string) {
  await updateRecordingStatus(recording.id, "failed");
  try {
    const db = await getDb();
    if (db) {
      await db.insert(userNotifications).values({
        userId: recording.userId,
        type: "error",
        title: "Transcription Failed",
        message: `Transcription failed for "${recording.title}": ${reason}`,
        recordingId: recording.id,
        isRead: 0,
      });
    }
  } catch (notifError) {
    console.error("[Transcription] Failed to create failure notification", notifError);
  }
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
    // The provider id is written only after submission returns, so a short
    // recording can finish and call back before that write lands. Answering
    // 2xx here told the provider the result was delivered and stopped it
    // retrying, permanently losing the transcript and leaving the recording
    // stuck in "processing". A 503 asks it to redeliver; by then the id is
    // saved. A genuinely deleted recording simply exhausts the provider's
    // bounded retries, which is harmless.
    console.warn(`[Transcription] No recording yet for transcript ${req.body.transcript_id}; asking for redelivery`);
    res.status(503).json({ error: "Recording not ready for this transcript yet" });
    return;
  }

  if (recording.status === "completed" || recording.status === "failed") {
    res.status(204).end();
    return;
  }

  if (req.body.status === "error") {
    // The webhook payload itself carries no error detail, only the status —
    // fetch the transcript record to recover the provider's actual reason
    // instead of leaving every failure as an unexplained "failed" status.
    let reason = "The transcription provider could not process this recording.";
    try {
      await retrieveSpeakerDiarization(req.body.transcript_id);
    } catch (error) {
      if (error instanceof Error && error.message) reason = error.message;
    }
    await failRecording(recording, reason);
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
    // The job finished but there was nothing to transcribe. Redelivery can't
    // change that, so fail the recording with the reason instead of 500ing
    // until the provider gives up and the recording spins forever.
    if (error instanceof Error && error.message === NO_SPEECH_ERROR) {
      await failRecording(recording, NO_SPEECH_ERROR);
      res.status(204).end();
      return;
    }
    console.error("[Transcription] AssemblyAI webhook processing failed", error);
    // A 500 asks AssemblyAI to retry the transient callback delivery.
    res.status(500).json({ error: "Transcript processing failed" });
  }
}
