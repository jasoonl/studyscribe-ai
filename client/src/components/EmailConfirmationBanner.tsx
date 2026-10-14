import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

/** For open sign-ups that have not confirmed their email yet (F4): explains why recording is held, and resends the link. */
export function EmailConfirmationBanner() {
  const { data, refetch } = trpc.signup.confirmation.useQuery(undefined, { refetchOnWindowFocus: true });
  const [sending, setSending] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") !== "1") return;
    toast.success(t("confirmEmail.confirmed"));
    params.delete("verified");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    void refetch();
  }, [refetch]);

  if (!data?.needed) return null;

  const resend = async () => {
    setSending(true);
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("confirmEmail.failed"));
      toast.success(body.alreadyConfirmed ? t("confirmEmail.already") : t("confirmEmail.sent", { email: data.email ?? "" }));
      if (body.alreadyConfirmed) void refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("confirmEmail.failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-border bg-brand-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        <span className="font-medium">{t("confirmEmail.title")}</span>{" "}
        <span className="text-muted-foreground">{t("confirmEmail.sentTo", { email: data.email ?? "" })}</span>
      </p>
      <Button size="sm" variant="outline" onClick={resend} disabled={sending} className="shrink-0 bg-background">
        {sending ? t("confirmEmail.sending") : t("confirmEmail.resend")}
      </Button>
    </div>
  );
}
