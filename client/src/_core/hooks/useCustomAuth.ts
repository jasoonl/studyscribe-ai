import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

export function useCustomAuth() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Try to get current user from session
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data);
        } else {
          setUser(null);
        }
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
