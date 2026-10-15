import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Ticket, CheckCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useSignupMode } from "@/lib/signupMode";
import { useI18n, Trans } from "@/i18n";

export default function Invite() {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const signup = useSignupMode();
  const { t } = useI18n();

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast.error(t("invite.enterCode"));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/validate-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.valid) {
        throw new Error(data.error || t("invite.invalid"));
      }

      setIsValid(true);
      if (data.email) setInviteEmail(data.email);
      toast.success(t("invite.verifiedToast"));

      // Redirect to signup with the validated code
      setTimeout(() => {
        window.location.href = `/signup?code=${encodeURIComponent(code.trim())}`;
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("invite.invalid");
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background p-4 focus:outline-none">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
            <Ticket className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{t("invite.title")}</h1>
          <p className="text-muted-foreground">
            {t("invite.intro")}
          </p>
        </div>

        <Card className="p-8 shadow-lg">
          {isValid ? (
            <div className="text-center py-4 space-y-3">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-semibold text-foreground">{t("invite.verified")}</p>
              {inviteEmail && (
                <p className="text-sm text-muted-foreground">
                  <Trans k="invite.signingUpAs" vars={{ email: inviteEmail }} parts={{ email: text => <span className="font-medium">{text}</span> }} />
                </p>
              )}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("invite.redirecting")}</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleValidate} className="space-y-4">
              <div>
                <label htmlFor="invite-code" className="block text-sm font-medium text-foreground mb-2">
                  {t("invite.code")}
                </label>
                <Input
                  id="invite-code"
                  type="text"
                  placeholder={t("invite.codePlaceholder")}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono tracking-widest text-center text-lg h-12"
                  autoFocus
                  disabled={isLoading}
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium"
                disabled={isLoading || !code.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {t("invite.verifying")}
                  </>
                ) : (
                  <>
                    {t("common.continue")}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          )}
        </Card>

        {/* Already have account */}
        <p className="text-center text-sm text-muted-foreground">
          {t("signup.haveAccount")}{" "}
          <a href="/login" className="text-accent font-medium hover:underline">
            {t("common.signIn")}
          </a>
        </p>

        {/* No invite? */}
        <p className="text-center text-sm text-muted-foreground">
          {t("invite.noCode")}{" "}
          <a href={signup.open ? "/signup" : "/request-access"} className="text-accent font-medium hover:underline">
            {signup.open ? t("invite.signUpWithout") : t("invite.requestAccess")}
          </a>
        </p>
      </div>
    </main>
  );
}
