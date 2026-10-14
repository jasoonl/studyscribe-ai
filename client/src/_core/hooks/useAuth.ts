import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSessionUser, forgetSessionUser, peekSessionUser } from "./sessionUser";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

/**
 * Custom authentication hook backed by our own REST API (`/api/auth/*`).
 * This replaces the previous Manus OAuth (tRPC auth.me) implementation.
 * All pages importing `useAuth` automatically use custom email/password +
 * Google OAuth sessions through this hook.
 */
export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } =
    options ?? {};

  const known = peekSessionUser();
  const [user, setUser] = useState<AuthUser | null>(known?.user ?? null);
  const [loading, setLoading] = useState(!known);
  const [error, setError] = useState<Error | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      setUser(await fetchSessionUser());
      setError(null);
    } catch (err) {
      console.error("Auth check failed:", err);
      setUser(null);
      setError(err instanceof Error ? err : new Error("Auth check failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      forgetSessionUser();
      setUser(null);
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  }, []);

  const state = useMemo(
    () => ({
      user,
      loading,
      error,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === "admin",
    }),
    [user, loading, error]
  );

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (loading) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [redirectOnUnauthenticated, redirectPath, loading, state.user]);

  return {
    ...state,
    refresh: fetchUser,
    logout,
  };
}
