/**
 * Constants and helpers shared by the server and the mobile app (F1).
 */

/** Header the app sends on /api/auth/login and /api/auth/signup to get its session token in the body. */
export const MOBILE_CLIENT_HEADER = "x-client";
export const MOBILE_CLIENT_VALUE = "mobile";

/** appSettings key holding the oldest app version the server still supports. */
export const MIN_MOBILE_VERSION_SETTING = "min_mobile_version";

/** Placeholder bundle id / package name until the owner registers the real one. */
export const MOBILE_BUNDLE_ID = "com.studyscribe.app";

/** URL scheme the app registers (studyscribe://recording/12). */
export const MOBILE_URL_SCHEME = "studyscribe";

/** Compares dotted versions ("1.2.10" > "1.2.9"). Missing parts count as 0; anything non-numeric counts as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function isValidVersion(value: string) {
  return /^\d{1,4}(\.\d{1,4}){0,2}$/.test(value);
}

/** Whether an installed app version must update before it can be used. */
export function needsUpdate(installed: string | null | undefined, minimum: string | null | undefined) {
  if (!installed || !minimum) return false;
  return compareVersions(installed, minimum) < 0;
}

export type MobileConfig = {
  minVersion: string | null;
  storeUrls: { ios: string | null; android: string | null };
};
