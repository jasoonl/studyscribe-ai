import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Mail, Lock, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MIN_AGE } from "@shared/legal";
import { safeNext } from "@/lib/safeNext";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";

export default function Login() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");

  const query = new URLSearchParams(search);
  const oauthError = query.get("error");
  // Where to go after signing in, such as a team invitation. Same-site paths only.
  const next = safeNext(query.get("next"));
  const [ssoOpen, setSsoOpen] = useState(query.get("sso") === "1");
  const [ssoEmail, setSsoEmail] = useState("");
  const [ssoAge, setSsoAge] = useState(false);
  const [ssoTerms, setSsoTerms] = useState(false);

  const startSso = (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams({ email: ssoEmail.trim(), origin: window.location.origin });
    if (next) params.set("next", next);
    if (ssoAge && ssoTerms) {
      params.set("acceptedTerms", "1");
      params.set("confirmedAge", "1");
    }
    window.location.href = `/api/auth/sso/start?${params}`;
  };

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        // The team requires single sign-on: open that panel with the address filled in.
        if (error.sso) {
          setSsoOpen(true);
          setSsoEmail(email);
        }
        throw new Error(error.error || "Login failed");
      }

      toast.success("Login successful!");
      // Hard reload to /dashboard so auth state is freshly read from the
      // session cookie (avoids stale client-side auth state).
      window.location.href = next ?? "/dashboard";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setFormError("");
    try {
      // Get Google auth URL from backend
      const params = new URLSearchParams({
        origin: window.location.origin,
        mode: "login",
      });
      if (next) params.set("next", next);
      const response = await fetch(`/api/auth/google?${params}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to initiate Google login");
      }

      const { authUrl } = await response.json();
      window.location.href = authUrl;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google login failed";
      setFormError(message);
      toast.error(message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">StudyScribe AI</h1>
          <p className="text-muted-foreground">Sign in to your account</p>
        </div>

        {(oauthError || formError) && (
          <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {oauthError || formError}
          </div>
        )}

        {/* Google OAuth Button */}
        <Button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          variant="outline"
          className="w-full mb-6 h-11 font-medium"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          )}
          Continue with Google
        </Button>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-card text-muted-foreground">Or continue with email</span>
          </div>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
          {/* Email Input */}
          <div className="relative">
            <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10"
              required
              disabled={isLoading}
            />
          </div>

          {/* Password Input */}
          <div className="relative">
            <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10"
              required
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground text-sm"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {/* Login Button */}
          <Button type="submit" className="w-full h-11 font-medium" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        {/* SAML single sign-on for teams (F3) */}
        <div className="mt-4 rounded-lg border border-border">
          <button
            type="button"
            aria-expanded={ssoOpen}
            onClick={() => setSsoOpen(open => !open)}
            className="w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Sign in with SSO
          </button>
          {ssoOpen && (
            <form onSubmit={startSso} className="space-y-3 border-t border-border px-4 py-4">
              <label htmlFor="sso-email" className="block text-sm text-muted-foreground">Your school or work email, if your team uses single sign-on</label>
              <Input id="sso-email" type="email" value={ssoEmail} onChange={event => setSsoEmail(event.target.value)} placeholder="name@school.edu" required />
              <fieldset className="space-y-2">
                <legend className="text-xs text-muted-foreground">Needed the first time you sign in</legend>
                <div className="flex items-start gap-2.5">
                  <Checkbox id="sso-age" checked={ssoAge} onCheckedChange={value => setSsoAge(value === true)} className="mt-0.5" />
                  <label htmlFor="sso-age" className="text-xs">I am at least {MIN_AGE} years old.</label>
                </div>
                <div className="flex items-start gap-2.5">
                  <Checkbox id="sso-terms" checked={ssoTerms} onCheckedChange={value => setSsoTerms(value === true)} className="mt-0.5" />
                  <label htmlFor="sso-terms" className="text-xs">
                    I agree to the <a href="/terms" target="_blank" rel="noopener" className="text-primary underline">Terms</a> and have read the <a href="/privacy" target="_blank" rel="noopener" className="text-primary underline">Privacy Policy</a>.
                  </label>
                </div>
              </fieldset>
              <Button type="submit" variant="outline" className="w-full" disabled={!ssoEmail.trim()}>Continue</Button>
            </form>
          )}
        </div>

        {/* Forgot Password Link */}
        <div className="text-center mt-4">
          <a href="/forgot-password" className="text-sm text-accent hover:underline">
            Forgot password?
          </a>
        </div>

        {/* Sign Up Link */}
        <div className="text-center mt-6 pt-6 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <a href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="text-accent font-medium hover:underline">
              Sign up
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}
