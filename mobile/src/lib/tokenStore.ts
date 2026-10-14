import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Where the session token lives: the iOS Keychain / Android Keystore through
 * expo-secure-store. The web preview has no keychain, so it uses
 * localStorage; that build is for testing only and never ships.
 */
export type TokenStore = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

const KEY = "studyscribe.session";

export const secureTokenStore: TokenStore =
  Platform.OS === "web"
    ? {
        async get() {
          try {
            return globalThis.localStorage?.getItem(KEY) ?? null;
          } catch {
            return null;
          }
        },
        async set(token) {
          try {
            globalThis.localStorage?.setItem(KEY, token);
          } catch {
            // Private browsing: the session lasts for this page only.
          }
        },
        async clear() {
          try {
            globalThis.localStorage?.removeItem(KEY);
          } catch {
            // Nothing stored.
          }
        },
      }
    : {
        get: () => SecureStore.getItemAsync(KEY),
        set: (token) => SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
        clear: () => SecureStore.deleteItemAsync(KEY),
      };

/** In-memory store for tests. */
export function memoryTokenStore(initial: string | null = null): TokenStore {
  let value = initial;
  return {
    async get() {
      return value;
    },
    async set(token) {
      value = token;
    },
    async clear() {
      value = null;
    },
  };
}
