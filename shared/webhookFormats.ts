/**
 * Native chat delivery for outgoing webhooks (Phase 6). A Slack incoming
 * webhook or a Discord webhook URL gets a readable message instead of the JSON
 * envelope; every other URL gets the envelope. Delivery, SSRF checks, pinning
 * and signing are the same for all three (the signature covers the bytes
 * actually sent); Slack and Discord simply ignore the signature headers.
 */
export type WebhookFormat = "json" | "slack" | "discord";

const SLACK_HOSTS = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

/** Which format a URL gets. Only https URLs on the real hosts and paths count. */
export function webhookFormatFor(rawUrl: string): WebhookFormat {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "json";
  }
  if (url.protocol !== "https:") return "json";
  const host = url.hostname.toLowerCase();
  if (SLACK_HOSTS.has(host) && /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return "slack";
  if (DISCORD_HOSTS.has(host) && /^\/api\/(v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return "discord";
  return "json";
}

export const WEBHOOK_FORMAT_LABELS: Record<WebhookFormat, string> = { json: "JSON", slack: "Slack", discord: "Discord" };

type Envelope = { id?: string; event?: string; createdAt?: string; data?: Record<string, any> };

const MAX_EXCERPT = 600;

function excerpt(text: unknown, max = MAX_EXCERPT): string {
  if (typeof text !== "string") return "";
  const flat = text.replace(/\r/g, "").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${(lastBreak > max * 0.6 ? cut.slice(0, lastBreak + 1) : cut).trimEnd()}…`;
}

/** The plain-language pieces of a message, before chat-specific escaping. */
export function describeEvent(envelope: Envelope): { headline: string; title: string; url: string | null; detail: string } {
  const data = envelope.data ?? {};
  const recording = data.recording ?? {};
  const title = typeof recording.title === "string" && recording.title ? recording.title : "Untitled recording";
  const url = typeof recording.url === "string" && /^https?:\/\//.test(recording.url) ? recording.url : null;
  switch (envelope.event) {
    case "recording.completed":
      return { headline: "Recording ready", title, url, detail: "The transcript and study tools are ready in StudyScribe." };
    case "transcript.ready": {
      const words = typeof data.transcript?.wordCount === "number" ? `${data.transcript.wordCount.toLocaleString("en-US")} words. ` : "";
      return { headline: "Transcript ready", title, url, detail: `${words}${excerpt(data.transcript?.text, 300)}`.trim() };
    }
    case "notes.generated":
      return { headline: "Study notes written", title, url, detail: excerpt(data.note?.content) };
    case "webhook.test":
      return { headline: "Test message", title: "StudyScribe is connected", url: null, detail: "Recording, transcript and notes updates you picked will appear here." };
    default:
      return { headline: "StudyScribe update", title, url, detail: "" };
  }
}

/** Slack mrkdwn treats &, < and > as control characters; escaping them also stops <!channel> pings. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slackBody(envelope: Envelope): Record<string, unknown> {
  const { headline, title, url, detail } = describeEvent(envelope);
  const titleText = url ? `<${url}|${escapeSlack(title)}>` : `*${escapeSlack(title)}*`;
  const blocks: Array<Record<string, unknown>> = [
    { type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(headline)}*\n${titleText}` } },
  ];
  if (detail) blocks.push({ type: "section", text: { type: "mrkdwn", text: escapeSlack(detail) } });
  return {
    text: `${headline}: ${title}`.slice(0, 300),
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  };
}

const BRAND_COLOR = 0x3446d9;

export function discordBody(envelope: Envelope): Record<string, unknown> {
  const { headline, title, url, detail } = describeEvent(envelope);
  return {
    username: "StudyScribe",
    // Never ping anyone, whatever the transcript or notes say ("@everyone").
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: title.slice(0, 256),
        ...(url ? { url } : {}),
        description: detail.slice(0, 4000) || undefined,
        color: BRAND_COLOR,
        author: { name: headline },
        ...(envelope.createdAt ? { timestamp: envelope.createdAt } : {}),
      },
    ],
  };
}

/** The bytes to send for a stored envelope, in the endpoint's format. */
export function formatWebhookBody(format: WebhookFormat, payload: string): string {
  if (format === "json") return payload;
  let envelope: Envelope;
  try {
    envelope = JSON.parse(payload);
  } catch {
    envelope = {};
  }
  return JSON.stringify(format === "slack" ? slackBody(envelope) : discordBody(envelope));
}
