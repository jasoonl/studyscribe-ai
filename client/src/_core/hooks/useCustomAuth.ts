import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { fetchSessionUser, forgetSessionUser, peekSessionUser } from "./sessionUser";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

export function useCustomAuth() {
  const [, navigate] = useLocation();
  const known = peekSessionUser();
  const [user, setUser] = useState<AuthUser | null>(known?.user ?? null);
  const [loading, setLoading] = useState(!known);
  const [error, setError] = useState<string | null>(null);

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Shared with every other caller on the page (one request).
        setUser(await fetchSessionUser());
      } catch (err) {
        console.error("Auth check failed:", err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      forgetSessionUser();
      setUser(null);
      navigate("/login");
    } catch (err) {
      console.error("Logout failed:", err);
      setError("Failed to logout");
    }
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === "admin";

  return {
    user,
    loading,
    error,
    isAuthenticated,
    isAdmin,
    logout,
  };
}
