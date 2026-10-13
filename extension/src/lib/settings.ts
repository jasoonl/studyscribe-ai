import { DEFAULT_ORIGIN, normalizeOrigin } from "./origin";

declare const __DEFAULT_ORIGIN__: string | undefined;

/** The build's default origin: production, or a local server for a development build. */
export const BUILD_DEFAULT_ORIGIN: string =
  typeof __DEFAULT_ORIGIN__ === "string" && __DEFAULT_ORIGIN__ ? __DEFAULT_ORIGIN__ : DEFAULT_ORIGIN;

const ORIGIN_KEY = "origin";

export async function getOrigin(): Promise<string> {
  try {
    const stored = await chrome.storage.sync.get(ORIGIN_KEY);
    const value = stored[ORIGIN_KEY];
    if (typeof value === "string") {
      const result = normalizeOrigin(value);
      if (result.ok) return result.origin;
    }
  } catch {
    // Storage unavailable: fall through to the default.
  }
  return BUILD_DEFAULT_ORIGIN;
}

export async function setOrigin(origin: string): Promise<void> {
  await chrome.storage.sync.set({ [ORIGIN_KEY]: origin });
}

const PREFS_KEY = "prefs";
export type Prefs = { withMic: boolean; language: string };
const DEFAULT_PREFS: Prefs = { withMic: false, language: "" };

export async function getPrefs(): Promise<Prefs> {
  try {
    const stored = await chrome.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(stored[PREFS_KEY] as Partial<Prefs> | undefined) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setPrefs(prefs: Partial<Prefs>): Promise<void> {
  const current = await getPrefs();
  await chrome.storage.local.set({ [PREFS_KEY]: { ...current, ...prefs } });
}
