import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { APP_VERSION } from "./config";
import { appPathForWebPath } from "./links";
import { trpc } from "./trpc";

/**
 * Push notifications (transcript ready, failed, shares, reminders): the
 * server sends them through Expo's push service to the token registered here
 * (server/nativePush.ts). Tapping one opens the screen its web path names.
 */

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
  });
}

let currentPushToken: string | null = null;
export const getPushToken = () => currentPushToken;

export type PushPermission = "granted" | "denied" | "undetermined" | "unsupported";

export async function pushPermission(): Promise<PushPermission> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  const { status } = await Notifications.getPermissionsAsync();
  return status as PushPermission;
}

/** Asks for permission (only when `ask`) and returns the Expo push token, or null. */
export async function obtainPushToken(ask: boolean): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (Platform.OS === "android") {
    // Android 13+ shows the permission prompt only once a channel exists.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Transcripts and reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  currentPushToken = token;
  return token;
}

/**
 * Registers this device for push once signed in (without prompting; the
 * prompt comes after the first recording, when it is clearly useful), and
 * routes notification taps.
 */
export function usePushRegistration(signedIn: boolean) {
  const register = trpc.mobile.registerDevice.useMutation();
  const registered = useRef(false);

  useEffect(() => {
    if (!signedIn || registered.current || Platform.OS === "web") return;
    registered.current = true;
    obtainPushToken(false)
      .then((token) => {
        if (token) register.mutate({ token, platform: Platform.OS === "ios" ? "ios" : "android", appVersion: APP_VERSION });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) registered.current = false;
  }, [signedIn]);

  const lastResponse = Platform.OS === "web" ? null : Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!signedIn || !lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const url = lastResponse.notification.request.content.data?.url;
    router.push(appPathForWebPath(typeof url === "string" ? url : null) as never);
    Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [lastResponse, signedIn]);
}

/** After the first recording: ask once, register the token. */
export function useAskForPush() {
  const register = trpc.mobile.registerDevice.useMutation();
  return async () => {
    const token = await obtainPushToken(true).catch(() => null);
    if (token) register.mutate({ token, platform: Platform.OS === "ios" ? "ios" : "android", appVersion: APP_VERSION });
    return Boolean(token);
  };
}
