import { AuthError, tokenState, type AuthClient, type AuthSuccess, type SessionUser } from "./authApi";
import type { TokenStore } from "./tokenStore";

/**
 * The app's session, independent of React so it can be tested: restores the
 * token from the keychain on launch, refreshes it when it is getting old,
 * and forgets it on sign-out or when the server says it is no longer valid.
 */

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut"; reason?: string }
  | { status: "signedIn"; token: string; user: SessionUser };

type Listener = (state: SessionState) => void;

export function createSessionController(store: TokenStore, client: AuthClient, now: () => number = () => Date.now()) {
  let state: SessionState = { status: "loading" };
  const listeners = new Set<Listener>();

  function set(next: SessionState) {
    state = next;
    listeners.forEach((listener) => listener(state));
  }

  async function adopt(result: AuthSuccess) {
    await store.set(result.token);
    set({ status: "signedIn", token: result.token, user: result.user });
    return result;
  }

  return {
    getState: () => state,
    getToken: () => (state.status === "signedIn" ? state.token : null),
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** On launch. A network failure keeps the stored session (the app works offline-first for recording). */
    async restore() {
      const token = await store.get();
      const freshness = tokenState(token, now());
      if (freshness === "missing" || freshness === "expired") {
        if (token) await store.clear();
        set({ status: "signedOut", reason: freshness === "expired" ? "Your session expired. Sign in again." : undefined });
        return state;
      }
      try {
        if (freshness === "refresh") return adopt(await client.refresh(token!)).then(() => state);
        const user = await client.me(token!);
        set({ status: "signedIn", token: token!, user });
      } catch (error) {
        if (error instanceof AuthError && error.status === 401) {
          await store.clear();
          set({ status: "signedOut", reason: "Your session ended. Sign in again." });
        } else {
          // Offline or server trouble: keep the person signed in with what we know.
          set({ status: "signedIn", token: token!, user: placeholderUser(token!) });
        }
      }
      return state;
    },

    signIn: adopt,

    /** When the API answers 401 to a request: the token was revoked or the account deleted. */
    async expire(reason = "Your session ended. Sign in again.") {
      if (state.status !== "signedIn") return;
      await store.clear();
      set({ status: "signedOut", reason });
    },

    async signOut(pushToken?: string | null) {
      const token = state.status === "signedIn" ? state.token : await store.get();
      await store.clear();
      set({ status: "signedOut" });
      await client.logout(token, pushToken);
    },
  };
}

export type SessionController = ReturnType<typeof createSessionController>;

/** Used only when the server cannot be reached at launch; replaced by the real profile on the next successful call. */
function placeholderUser(token: string): SessionUser {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(globalThis.atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return { id: Number(json.userId) || 0, email: String(json.email ?? ""), name: null, role: json.role === "admin" ? "admin" : "user" };
  } catch {
    return { id: 0, email: "", name: null, role: "user" };
  }
}
