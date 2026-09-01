import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

export type OwnerNotificationProvider =
  | { name: "webhook"; url: string }
  | { name: "manus-forge"; url: string }
  | null;

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const buildEndpointUrl = (baseUrl: string): string => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("webdevtoken.v1.WebDevService/SendNotification", normalizedBase).toString();
};

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Notification title is required." });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Notification content is required." });
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.` });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.` });
  }
  return { title, content };
};

export function getOwnerNotificationProvider(): OwnerNotificationProvider {
  const webhookUrl = process.env.OWNER_ALERT_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    try {
      const parsed = new URL(webhookUrl);
      return parsed.protocol === "https:" ? { name: "webhook", url: parsed.toString() } : null;
    } catch {
      return null;
    }
  }
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    return { name: "manus-forge", url: buildEndpointUrl(ENV.forgeApiUrl) };
  }
  return null;
}

/**
 * Uses a project-owned HTTPS webhook outside Manus. Returning false lets
 * callers degrade gracefully when no owner alert channel has been configured.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const { title, content } = validatePayload(payload);
  const provider = getOwnerNotificationProvider();
  if (!provider) return false;

  try {
    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(provider.name === "manus-forge"
          ? { authorization: `Bearer ${ENV.forgeApiKey}`, "connect-protocol-version": "1" }
          : process.env.OWNER_ALERT_WEBHOOK_SECRET
            ? { authorization: `Bearer ${process.env.OWNER_ALERT_WEBHOOK_SECRET}` }
            : {}),
      },
      body: JSON.stringify({ title, content }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[Notification] Failed to notify owner through ${provider.name} (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling owner notification service:", error);
    return false;
  }
}
