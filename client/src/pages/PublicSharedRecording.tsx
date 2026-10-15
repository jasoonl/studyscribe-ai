import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, Link2Off } from "lucide-react";
import { useEffect } from "react";
import { Link } from "wouter";
import { SharedRecordingView } from "@/components/SharedRecordingView";
import { Button } from "@/components/ui/button";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { rememberReferral } from "@/lib/referral";
import { useSignupMode } from "@/lib/signupMode";
import { useI18n } from "@/i18n";

export default function PublicSharedRecording() {
  const { t } = useI18n();
  const [, params] = useRoute("/shared/:token");
  const token = params?.token ?? "";

  const { data: bundle, isLoading, error } = trpc.sharing.getByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );
  const { isAuthenticated, loading: authLoading } = useCustomAuth();
  const signup = useSignupMode();
  const visitor = !authLoading && !isAuthenticated;

  // A visitor who signs up after reading this credits the person who shared it (Phase 7).
  // A link they arrived with earlier wins.
  useEffect(() => {
    if (visitor && bundle?.referralCode) rememberReferral(bundle.referralCode, { replace: false });
  }, [visitor, bundle?.referralCode]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-center px-4">
        <Link2Off className="w-10 h-10 text-muted-foreground" />
        <p className="text-lg font-medium">{t("publicShare.invalid")}</p>
        <p className="text-sm text-muted-foreground">{t("publicShare.askOwner")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SharedRecordingView bundle={bundle} />
      {visitor && (
        <aside aria-labelledby="made-with" className="border-t border-border bg-brand-mist">
          <div className="container flex max-w-4xl flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="made-with" className="text-lg font-semibold">{t("publicShare.madeWith")}</h2>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                {t("publicShare.pitch")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button asChild>
                <Link href={signup.href}>{signup.open ? t("publicShare.signUpFree") : t("publicShare.requestAccess")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/">{t("publicShare.howItWorks")}</Link>
              </Button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
