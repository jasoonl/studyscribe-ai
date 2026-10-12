/** Events a person can subscribe a webhook endpoint to (E4). */
export const WEBHOOK_EVENTS = ["recording.completed", "transcript.ready", "notes.generated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "recording.completed": "A recording finishes processing",
  "transcript.ready": "A transcript is ready (includes the text)",
  "notes.generated": "Study notes are written",
};

/** Header names, documented on the Help page so receivers can verify deliveries. */
export const WEBHOOK_SIGNATURE_HEADER = "StudyScribe-Signature";
export const WEBHOOK_EVENT_HEADER = "StudyScribe-Event";
export const WEBHOOK_DELIVERY_HEADER = "StudyScribe-Delivery";

export const MAX_WEBHOOKS_PER_USER = 5;
