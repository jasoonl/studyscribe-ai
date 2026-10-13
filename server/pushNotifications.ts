import webpush from "web-push";
import { deletePushSubscription, getPushSubscriptionsByUserId } from "./db";
import { sendNativePush } from "./nativePush";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

function isVapidConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

function configureVapid() {
  if (!isVapidConfigured()) throw new Error("Browser push is not configured");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export function getBrowserPushConfiguration() {
  return {
    supported: isVapidConfigured(),
    publicKey: isVapidConfigured() ? process.env.VAPID_PUBLIC_KEY! : null,
  };
}

/**
 * Sends to the user's browsers (Web Push) and to their phones running the
 * mobile app (Expo push, server/nativePush.ts). The name predates the app;
 * every caller wants both.
 */
export async function sendBrowserPush(userId: number, payload: PushPayload) {
  const native = await sendNativePush(userId, payload);
  if (!isVapidConfigured()) return { delivered: native.delivered };
  configureVapid();

  const subscriptions = await getPushSubscriptionsByUserId(userId);
  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 },
        );
        delivered += 1;
      } catch (error: unknown) {
        const statusCode = typeof error === "object" && error && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscription(userId, subscription.endpointHash);
        }
      }
    }),
  );
  return { delivered: delivered + native.delivered };
}
