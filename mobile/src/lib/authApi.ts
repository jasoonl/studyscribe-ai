import { MOBILE_CLIENT_HEADER, MOBILE_CLIENT_VALUE } from "@shared/mobile";

/**
 * The REST auth endpoints, as the app calls them. Login and sign-up are the
 * web's own endpoints with `X-Client: mobile`, which makes them return the
 * session token in the body; the app keeps it in the keychain and sends it as
 * a bearer token (see server/mobileAuth.ts).
 */

export type SessionUser = { id: number; email: string; name: string | null; role: "admin" | "user" };
export type AuthSuccess = { token: string; user: SessionUser; created?: boolean; confirmationSent?: boolean };

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type AuthClient = ReturnType<typeof createAuthClient>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createAuthClient(baseUrl: string, fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  async function request<T>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? "POST",
        headers: {
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          [MOBILE_CLIENT_HEADER]: MOBILE_CLIENT_VALUE,
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new AuthError("Can't reach StudyScribe. Check your connection and try again.", 0);
    }
    const data = (await response.json().catch(() => null)) as any;
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : response.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Something went wrong. Please try again.";
      throw new AuthError(message, response.status);
    }
    return data as T;
  }

  function requireToken(data: any): AuthSuccess {
    if (!data || typeof data.token !== "string" || !data.user) throw new AuthError("The server did not return a session. Update the app and try again.", 500);
    return data as AuthSuccess;
  }

  return {
    async login(email: string, password: string) {
      return requireToken(await request("/api/auth/login", { body: { email: email.trim(), password } }));
    },
    async signup(input: { email: string; password: string; name: string; inviteCode: string; acceptedTerms: boolean; confirmedAge: boolean }) {
      return requireToken(await request("/api/auth/signup", { body: { ...input, email: input.email.trim(), inviteCode: input.inviteCode.trim() } }));
    },
    async google(input: { idToken: string; mode: "login" | "signup"; inviteCode?: string; acceptedTerms?: boolean; confirmedAge?: boolean }) {
      return requireToken(await request("/api/auth/google/native", { body: input }));
    },
    async apple(input: { identityToken: string; rawNonce: string; fullName?: string | null; mode: "login" | "signup"; inviteCode?: string; acceptedTerms?: boolean; confirmedAge?: boolean }) {
      return requireToken(await request("/api/auth/apple/native", { body: input }));
    },
    async refresh(token: string) {
      return requireToken(await request("/api/auth/token/refresh", { token }));
    },
    async logout(token: string | null, pushToken?: string | null) {
      await request("/api/auth/token/logout", { token, body: { pushToken: pushToken ?? null } }).catch(() => undefined);
    },
    async me(token: string) {
      return request<SessionUser>("/api/auth/me", { method: "GET", token });
    },
    async forgotPassword(email: string) {
      return request<{ success: boolean; message: string }>("/api/auth/forgot-password", { body: { email: email.trim() } });
    },
    async validateInvite(code: string) {
      return request<{ valid: boolean; email?: string; error?: string }>("/api/auth/validate-invite", { body: { code: code.trim() } });
    },
    async config() {
      return request<{ minVersion: string | null; storeUrls: { ios: string | null; android: string | null } }>("/api/mobile/config", { method: "GET" });
    },
  };
}

/** Reads the expiry (seconds since epoch) of a session JWT without verifying it; null when unreadable. */
export function tokenExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = JSON.parse(globalThis.atob(base64));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

/** Sessions last 30 days; refresh once fewer than 20 remain, so a weekly user never gets signed out. */
export const REFRESH_WHEN_LEFT_SECONDS = 20 * 24 * 60 * 60;

export function tokenState(token: string | null, nowMs = Date.now()): "missing" | "expired" | "refresh" | "fresh" {
  if (!token) return "missing";
  const exp = tokenExpiry(token);
  if (exp === null) return "expired";
  const left = exp - Math.floor(nowMs / 1000);
  if (left <= 0) return "expired";
  return left < REFRESH_WHEN_LEFT_SECONDS ? "refresh" : "fresh";
}
