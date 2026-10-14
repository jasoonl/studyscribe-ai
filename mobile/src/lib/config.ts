import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Where the API lives. Builds set EXPO_PUBLIC_API_URL (eas.json profiles); the
 * web preview (react-native-web, used for testing in a browser) talks to the
 * origin it is served from, which proxies /api to a local server.
 */
export function resolveApiUrl(env: string | undefined, platform: string, origin: string | null): string {
  const configured = env?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (platform === "web" && origin) return origin;
  return "https://studyscribe-ai.vercel.app";
}

export const API_URL = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  Platform.OS,
  Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null,
);

/** The web app, for pages the app opens in the browser (legal pages, help, billing). */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL?.trim() || API_URL).replace(/\/+$/, "");

export const APP_VERSION: string = Constants.expoConfig?.version ?? "1.0.0";

export function apiUrl(path: string) {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
