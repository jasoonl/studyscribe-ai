import { describe, expect, it } from "vitest";
import { describeEvent, discordBody, escapeSlack, formatWebhookBody, slackBody, webhookFormatFor } from "@shared/webhookFormats";
import { buildEnvelope, signWebhookPayload, verifyWebhookSignature } from "./outgoingWebhooks";

const slackUrl = "https://hooks.slack.com/services/T0001/B0002/abcDEF123";
const discordUrl = "https://discord.com/api/webhooks/123456789/token_abc-DEF";

describe("webhookFormatFor", () => {
  it("recognises real Slack and Discord webhook URLs", () => {
    expect(webhookFormatFor(slackUrl)).toBe("slack");
    expect(webhookFormatFor(discordUrl)).toBe("discord");
    expect(webhookFormatFor("https://discordapp.com/api/v10/webhooks/1/abc")).toBe("discord");
  });

  it("treats lookalikes and plain http as ordinary JSON endpoints", () => {
    expect(webhookFormatFor("http://hooks.slack.com/services/T/B/x")).toBe("json");
    expect(webhookFormatFor("https://hooks.slack.com.evil.example/services/T/B/x")).toBe("json");
    expect(webhookFormatFor("https://discord.com/channels/1/2")).toBe("json");
    expect(webhookFormatFor("https://example.com/webhook")).toBe("json");
    expect(webhookFormatFor("not a url")).toBe("json");
  });
});

const envelope = (event: string, data: Record<string, unknown>) => JSON.parse(buildEnvelope(event, data, "dlv_1", new Date("2026-10-14T10:00:00Z")));

describe("chat messages", () => {
  const recording = { id: 4, title: "Cells <b> & membranes", url: "https://app.example/recording/4" };

  it("describes each event in plain words", () => {
    expect(describeEvent(envelope("recording.completed", { recording })).headline).toBe("Recording ready");
    const transcript = describeEvent(envelope("transcript.ready", { recording, transcript: { wordCount: 1200, text: "Hello class. ".repeat(100) } }));
    expect(transcript.detail.startsWith("1,200 words.")).toBe(true);
    expect(transcript.detail.length).toBeLessThan(330);
    expect(describeEvent(envelope("webhook.test", {})).headline).toBe("Test message");
  });

  it("escapes Slack control characters so text cannot ping a channel", () => {
    expect(escapeSlack("<!channel> & <@U1>")).toBe("&lt;!channel&gt; &amp; &lt;@U1&gt;");
    const body = slackBody(envelope("notes.generated", { recording, note: { content: "Notes <!here>" } })) as any;
    expect(JSON.stringify(body)).not.toContain("<!here>");
    expect(body.blocks[0].text.text).toContain("<https://app.example/recording/4|Cells &lt;b&gt; &amp; membranes>");
    expect(body.text).toContain("Study notes written");
  });

  it("never lets Discord mention anyone", () => {
    const body = discordBody(envelope("notes.generated", { recording, note: { content: "@everyone exam moved" } })) as any;
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].url).toBe("https://app.example/recording/4");
    expect(body.embeds[0].timestamp).toBe("2026-10-14T10:00:00.000Z");
  });

  it("drops links that are not http(s)", () => {
    expect(describeEvent(envelope("recording.completed", { recording: { title: "x", url: "javascript:alert(1)" } })).url).toBeNull();
  });

  it("keeps JSON endpoints byte for byte, and signs whatever is sent", () => {
    const payload = buildEnvelope("recording.completed", { recording }, "dlv_2");
    expect(formatWebhookBody("json", payload)).toBe(payload);
    const slack = formatWebhookBody("slack", payload);
    const header = signWebhookPayload("whsec_x", slack, 1_800_000_000);
    expect(verifyWebhookSignature("whsec_x", slack, header, { nowSeconds: 1_800_000_000 })).toBe(true);
    expect(formatWebhookBody("discord", "{broken")).toContain("StudyScribe");
  });
});
