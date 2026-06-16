import { useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import Landing from "./Landing";

/**
 * Home Page — Smart Router
 * 
 * - If authenticated: Redirect to /dashboard
 * - If not authenticated: Show Landing page
 */

export default function Home() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  // Redirect to dashboard if authenticated
  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, user, loading, navigate]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  // If not authenticated, show landing page
  if (!isAuthenticated) {
    return <Landing />;
  }

  // If authenticated, show loading while redirecting
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-accent" />
    </div>
  );
}
