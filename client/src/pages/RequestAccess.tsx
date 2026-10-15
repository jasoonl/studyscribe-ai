import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useSignupMode } from "@/lib/signupMode";
import { useI18n, Trans } from "@/i18n";

export default function RequestAccess() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const signup = useSignupMode();
  const { t } = useI18n();

  const requestInvite = trpc.customAuth.requestInvite.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setError("");
    },
    onError: (err) => {
      setError(err.message || t("requestAccess.failed"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim()) return;
    requestInvite.mutate({ name: name.trim(), email: email.trim(), reason: reason.trim() || undefined });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <img
          src="/logo.webp"
          alt="StudyScribe AI"
          className="w-12 h-12 rounded-xl shadow-sm"
        />
        <span className="text-xl font-bold text-foreground">StudyScribe AI</span>
      </div>

      <div className="w-full max-w-md bg-card rounded-2xl shadow-sm border border-border p-8">
        {submitted ? (
          /* Success state */
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t("requestAccess.receivedTitle")}</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              <Trans k="requestAccess.receivedText" vars={{ name, email }} parts={{ b: text => <strong>{text}</strong> }} />
            </p>
            <p className="text-muted-foreground text-xs">
              {t("requestAccess.checkInbox")}
            </p>
            <Link href="/login">
              <Button variant="outline" className="mt-2 gap-2">
                <ArrowLeft className="w-4 h-4" />
                {t("requestAccess.backToSignIn")}
              </Button>
            </Link>
          </div>
        ) : signup.open ? (
          /* Open sign-up: no invite needed, so send people straight to the form. */
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold text-foreground">{t("requestAccess.openTitle")}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("requestAccess.openText")}
            </p>
            <Button asChild className="w-full">
              <Link href="/signup">{t("requestAccess.createFree")}</Link>
            </Button>
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-5 text-center text-sm text-muted-foreground">
              <p>
                {t("requestAccess.haveCode")}{" "}
                <Link href="/invite" className="font-medium text-primary hover:underline">{t("requestAccess.enterIt")}</Link>
              </p>
              <p>
                {t("signup.haveAccount")}{" "}
                <Link href="/login" className="font-medium text-primary hover:underline">{t("common.signIn")}</Link>
              </p>
            </div>
          </div>
        ) : (
          /* Form state */
          <>
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-foreground">{t("requestAccess.title")}</h1>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("requestAccess.intro")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">{t("requestAccess.name")}</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder={t("requestAccess.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={requestInvite.isPending}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t("common.emailAddress")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("requestAccess.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={requestInvite.isPending}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reason">
                  {t("requestAccess.reason")}{" "}
                  <span className="text-muted-foreground font-normal">{t("requestAccess.optional")}</span>
                </Label>
                <Textarea
                  id="reason"
                  placeholder={t("requestAccess.reasonPlaceholder")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={requestInvite.isPending}
                  className="resize-none"
                />
                <span className="text-xs text-muted-foreground text-right">{reason.length}/1000</span>
              </div>

              {error && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full bg-primary hover:brightness-110 text-white mt-1"
                disabled={requestInvite.isPending || !name.trim() || !email.trim()}
              >
                {requestInvite.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("requestAccess.submitting")}
                  </>
                ) : (
                  t("requestAccess.submit")
                )}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                <Trans k="requestAccess.privacy" parts={{ privacy: text => <Link href="/privacy" className="text-primary underline">{text}</Link> }} />
              </p>
            </form>

            <div className="mt-6 pt-5 border-t border-border flex flex-col gap-2 text-center text-sm text-muted-foreground">
              <p>
                {t("requestAccess.alreadyHaveCode")}{" "}
                <Link href="/invite" className="text-primary hover:underline font-medium">
                  {t("requestAccess.enterIt")}
                </Link>
              </p>
              <p>
                {t("signup.haveAccount")}{" "}
                <Link href="/login" className="text-primary hover:underline font-medium">
                  {t("common.signIn")}
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
