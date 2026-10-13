import { and, eq, inArray } from "drizzle-orm";
import { deviceTokens } from "../drizzle/schema";
import { getDb } from "./db";
import { isSchemaMissingError } from "./schemaTolerance";

/**
 * Push notifications to the mobile app (F1), through Expo's push service,
 * which forwards to APNs (iOS) and FCM (Android) with the credentials stored
 * in the Expo project. Sent next to browser push from sendBrowserPush, so
 * every existing notification (transcript ready, failed, reminders, shares)
 * reaches the phone without its callers changing.
 *
 * EXPO_ACCESS_TOKEN is optional: Expo accepts unauthenticated sends unless
 * "enhanced push security" is switched on for the project, in which case the
 * token is required. Until migration 0024 is applied the deviceTokens table
 * does not exist and every function here quietly does nothing.
 */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
/** Expo accepts at most 100 messages per request. */
const BATCH_SIZE = 100;

export type NativePushPayload = { title: string; body: string; url?: string; tag?: string };
export type DevicePlatform = "ios" | "android";

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && token.length <= 255 && EXPO_TOKEN_PATTERN.test(token);
}

/**
 * The message for one device. `url` is the web path (e.g. /recording/12); the
 * app maps it to its own screen. `tag` groups notifications about the same
 * thing (iOS thread, Android collapse key is not used so none are dropped).
 */
export function buildExpoMessage(token: string, payload: NativePushPayload) {
  return {
    to: token,
    title: payload.title.slice(0, 178),
    body: payload.body.slice(0, 1000),
    sound: "default" as const,
    priority: "high" as const,
    channelId: "default",
    ...(payload.tag ? { threadId: payload.tag } : {}),
    data: { url: payload.url ?? "/", ...(payload.tag ? { tag: payload.tag } : {}) },
  };
}

type ExpoTicket = { status: "ok"; id?: string } | { status: "error"; message?: string; details?: { error?: string } };

/** Tokens Expo says are dead (app uninstalled, token rotated), to delete. */
export function deadTokensFromTickets(tokens: string[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered" && tokens[index]) dead.push(tokens[index]);
  });
  return dead;
}

export async function registerDeviceToken(input: { userId: number; token: string; platform: DevicePlatform; appVersion?: string | null }) {
  if (!isExpoPushToken(input.token)) throw new Error("That is not an Expo push token.");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const appVersion = input.appVersion ? input.appVersion.slice(0, 32) : null;
  try {
    // One row per token: re-registering refreshes it and moves it to whoever is signed in now.
    await db
      .insert(deviceTokens)
      .values({ userId: input.userId, token: input.token, platform: input.platform, appVersion, lastSeenAt: now })
      .onDuplicateKeyUpdate({ set: { userId: input.userId, platform: input.platform, appVersion, lastSeenAt: now } });
    return { registered: true as const };
  } catch (error) {
    if (isSchemaMissingError(error)) return { registered: false as const };
    throw error;
  }
}

export async function unregisterDeviceToken(userId: number, token: string) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
  }
}

async function tokensForUser(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db.select({ token: deviceTokens.token }).from(deviceTokens).where(eq(deviceTokens.userId, userId));
    return rows.map((row) => row.token);
  } catch (error) {
    if (isSchemaMissingError(error)) return [];
    throw error;
  }
}

async function deleteTokens(tokens: string[]) {
  if (!tokens.length) return;
  const db = await getDb();
  if (!db) return;
  await db.delete(deviceTokens).where(inArray(deviceTokens.token, tokens));
}

export type NativePushDeps = {
  tokensForUser: (userId: number) => Promise<string[]>;
  deleteTokens: (tokens: string[]) => Promise<void>;
  fetch: typeof fetch;
  accessToken?: string;
};

const defaultDeps = (): NativePushDeps => ({
  tokensForUser,
  deleteTokens,
  fetch: (...args) => fetch(...args),
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

/** Sends to every app the user is signed in to. Never throws: a push failure must not fail the work that caused it. */
export async function sendNativePush(userId: number, payload: NativePushPayload, deps: NativePushDeps = defaultDeps()) {
  let delivered = 0;
  try {
    const tokens = await deps.tokensForUser(userId);
    for (let start = 0; start < tokens.length; start += BATCH_SIZE) {
      const batch = tokens.slice(start, start + BATCH_SIZE);
      const response = await deps.fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(deps.accessToken ? { Authorization: `Bearer ${deps.accessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((token) => buildExpoMessage(token, payload))),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        console.error(`[NativePush] Expo push service answered ${response.status}`);
        continue;
      }
      const body = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
      const tickets = Array.isArray(body?.data) ? body!.data : [];
      delivered += tickets.filter((ticket) => ticket?.status === "ok").length;
      await deps.deleteTokens(deadTokensFromTickets(batch, tickets));
    }
  } catch (error) {
    console.error("[NativePush] send failed:", error instanceof Error ? error.message : error);
  }
  return { delivered };
}

export async function deleteDeviceTokensForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(deviceTokens).where(eq(deviceTokens.userId, userId));
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
  }
}

export async function exportDevicesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({ platform: deviceTokens.platform, appVersion: deviceTokens.appVersion, createdAt: deviceTokens.createdAt, lastSeenAt: deviceTokens.lastSeenAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));
    return rows;
  } catch (error) {
    if (isSchemaMissingError(error)) return [];
    throw error;
  }
}
