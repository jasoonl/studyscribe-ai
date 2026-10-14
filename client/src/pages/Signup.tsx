import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { MIN_AGE } from "@shared/legal";
import { Mail, Lock, User, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { safeNext } from "@/lib/safeNext";
import { Trans, useI18n } from "@/i18n";
import { LanguagePicker } from "@/components/LanguagePicker";

export default function Signup() {
  // Invite code comes from the URL — user arrives here from /invite page
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get("code") || "";
  const next = safeNext(params.get("next"));
  const { t } = useI18n();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [confirmedAge, setConfirmedAge] = useState(false);
  const [inviteChecked, setInviteChecked] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  // Without an invite code the form is only for open sign-up; otherwise go to /invite.
  const mode = trpc.signup.mode.useQuery(undefined, { enabled: !inviteCode, retry: false, refetchOnWindowFocus: false });
  const openSignup = !inviteCode && mode.data?.openSignup === true;
  useEffect(() => {
    if (inviteCode || mode.isLoading) return;
    if (mode.data?.openSignup) setInviteChecked(true);
    else window.location.href = "/invite";
  }, [inviteCode, mode.isLoading, mode.data?.openSignup]);

  useEffect(() => {
    if (!inviteCode) return;

    // Silently validate the invite code
    const validateInvite = async () => {
      try {
        const response = await fetch("/api/auth/validate-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode }),
        });

        const data = await response.json();
        if (data.valid) {
          setInviteChecked(true);
          if (data.email) {
            setInviteEmail(data.email);
            setFormData((prev) => ({ ...prev, email: data.email }));
          }
        } else {
          setInviteError(data.error || t("signup.invalidCode"));
        }
      } catch {
        setInviteError(t("signup.checkFailed"));
      }
    };

    validateInvite();
  }, [inviteCode]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (formData.password !== formData.confirmPassword) {
      toast.error(t("signup.mismatch"));
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      toast.error(t("signup.tooShort"));
      setIsLoading(false);
      return;
    }

    if (!confirmedAge) {
      toast.error(t("signup.needAge", { age: MIN_AGE }));
      setIsLoading(false);
      return;
    }
    if (!acceptedTerms) {
      toast.error(t("signup.needTerms"));
      setIsLoading(false);
      return;
    }

    if (!formData.name.trim()) {
      toast.error(t("signup.needName"));
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          inviteCode: openSignup ? undefined : inviteCode,
          acceptedTerms,
          confirmedAge,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t("signup.failed"));
      }

      const created = await response.json().catch(() => ({}));
      toast.success(created.confirmationSent ? t("signup.createdConfirm") : t("signup.created"));
      window.location.href = next ?? "/dashboard";
    } catch (error) {
      const message = error instanceof Error ? error.message : t("signup.failed");
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    if (!confirmedAge) {
      toast.error(t("signup.needAge", { age: MIN_AGE }));
      return;
    }
    if (!acceptedTerms) {
      toast.error(t("signup.needTerms"));
      return;
    }
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        origin: window.location.origin,
        mode: "signup",
        acceptedTerms: "1",
        confirmedAge: "1",
      });
      // The server checks the invite again after Google answers; it works for the invited address only.
      if (!openSignup && inviteCode) params.set("inviteCode", inviteCode);
      if (next) params.set("next", next);
      const response = await fetch(`/api/auth/google?${params}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t("signup.googleFailed"));
      }

      const { authUrl } = await response.json();
      window.location.href = authUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : t("signup.googleFailed");
      toast.error(message);
      setIsLoading(false);
    }
  };

  // Show error state if invite is invalid
  if (inviteError) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background p-4 focus:outline-none">
        <Card className="w-full max-w-md p-8 shadow-lg text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">{t("signup.invalidTitle")}</h2>
          <p className="text-muted-foreground mb-6">{inviteError}</p>
          <Button onClick={() => (window.location.href = "/invite")} className="w-full">
            {t("signup.tryAnother")}
          </Button>
        </Card>
      </main>
    );
  }

  // Show loading while validating invite
  if (!inviteChecked) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background focus:outline-none">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background p-4 focus:outline-none">
      <Card className="w-full max-w-md p-8 shadow-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{openSignup ? t("signup.titleOpen") : t("signup.title")}</h1>
          <p className="text-muted-foreground">{openSignup ? t("signup.subtitleOpen") : t("signup.subtitle")}</p>
        </div>

        <fieldset className="mb-5 space-y-3 rounded-lg border border-border bg-secondary/50 p-3">
          <legend className="sr-only">{t("signup.before")}</legend>
          <div className="flex items-start gap-3">
            <Checkbox id="confirm-age" checked={confirmedAge} onCheckedChange={(v) => setConfirmedAge(v === true)} className="mt-0.5" />
            <label htmlFor="confirm-age" className="text-sm text-foreground">
              {t("signup.age", { age: MIN_AGE })}
            </label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="accept-terms" checked={acceptedTerms} onCheckedChange={(v) => setAcceptedTerms(v === true)} className="mt-0.5" />
            <label htmlFor="accept-terms" className="text-sm text-foreground">
              <Trans
                k="signup.terms"
                parts={{
                  terms: text => <a href="/terms" target="_blank" rel="noopener" className="font-medium text-primary underline">{text}</a>,
                  privacy: text => <a href="/privacy" target="_blank" rel="noopener" className="font-medium text-primary underline">{text}</a>,
                }}
              />
            </label>
          </div>
        </fieldset>

        {/* Google Sign-Up Button */}
        <Button
          onClick={handleGoogleSignup}
          disabled={isLoading}
          variant="outline"
          className="w-full mb-4 h-11 font-medium"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          {t("common.continueWithGoogle")}
        </Button>
        {!openSignup && inviteEmail ? (
          <p className="-mt-2 mb-4 text-center text-xs text-muted-foreground">{t("signup.inviteGoogle", { email: inviteEmail })}</p>
        ) : null}

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-card text-muted-foreground">{t("signup.orEmail")}</span>
          </div>
        </div>

        {/* Signup Form */}
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("signup.fullName")}
              aria-label={t("signup.fullName")}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="pl-10"
              required
              disabled={isLoading}
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder={t("common.emailAddress")}
              aria-label={t("common.emailAddress")}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="pl-10"
              required
              disabled={isLoading}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type={showPassword ? "text" : "password"}
              placeholder={t("signup.passwordHint")}
              aria-label={t("signup.passwordHint")}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="pl-10"
              required
              disabled={isLoading}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type={showPassword ? "text" : "password"}
              placeholder={t("signup.confirmPassword")}
              aria-label={t("signup.confirmPassword")}
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="pl-10"
              required
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground text-sm"
            >
              {showPassword ? t("common.hide") : t("common.show")}
            </button>
          </div>

          <Button type="submit" className="w-full h-11 font-medium" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {t("signup.creating")}
              </>
            ) : (
              t("signup.create")
            )}
          </Button>
        </form>

        {/* Login link */}
        <div className="text-center mt-6 pt-6 border-t border-border">
          <p className="text-sm text-muted-foreground">
            {t("signup.haveAccount")}{" "}
            <a href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-accent font-medium hover:underline">
              {t("common.signIn")}
            </a>
          </p>
        </div>
        <div className="mt-6 flex justify-center">
          <LanguagePicker id="signup-language" />
        </div>
      </Card>
    </main>
  );
}
