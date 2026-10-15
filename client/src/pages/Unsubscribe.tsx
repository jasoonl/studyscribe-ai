import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import PublicLayout from "@/components/landing/PublicLayout";
import { Button } from "@/components/ui/button";
import { ContactEmail } from "@/components/LegalLayout";
import { useI18n, Trans, t } from "@/i18n";
import { CONTACT_EMAIL } from "@shared/legal";

type State = { kind: "loading" } | { kind: "invalid" } | { kind: "ready"; email: string; optedOut: boolean } | { kind: "error"; message: string };

/**
 * "Don't email me from StudyScribe" (D4). The link in every email that was not
 * asked for by its recipient (such as notes a meeting organiser sent) opens
 * this page; the choice is saved with a button press, so link scanners that
 * open the page do not unsubscribe anyone. Mail clients' one-click
 * unsubscribe POSTs to the same endpoint directly.
 */
export default function Unsubscribe() {
  useI18n();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    fetch(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async response => (response.ok ? setState({ kind: "ready", ...(await response.json()) }) : setState({ kind: "invalid" })))
      .catch(() => setState({ kind: "error", message: t("unsubscribe.loadFailed") }));
  }, [token]);

  const save = async (optedOut: boolean) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(optedOut ? {} : { action: "resubscribe" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("unsubscribe.saveFailed"));
      setState({ kind: "ready", email: body.email, optedOut: body.optedOut });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : t("unsubscribe.saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PublicLayout>
      <section className="mx-auto max-w-xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">{t("unsubscribe.title")}</h1>
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          {state.kind === "loading" ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : state.kind === "invalid" ? (
            <p className="text-muted-foreground"><Trans k="unsubscribe.invalid" vars={{ address: CONTACT_EMAIL }} parts={{ email: () => <ContactEmail subject="Stop emails" /> }} /></p>
          ) : state.kind === "error" ? (
            <p className="text-muted-foreground" role="alert">{state.message}</p>
          ) : state.optedOut ? (
            <div className="space-y-4">
              <p className="font-medium" role="status">{t("unsubscribe.done", { email: state.email })}</p>
              <p className="text-sm text-muted-foreground">
                {t("unsubscribe.covers")}
              </p>
              <Button variant="outline" disabled={saving} onClick={() => void save(false)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("unsubscribe.undo")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p><Trans k="unsubscribe.ask" vars={{ email: state.email }} parts={{ email: text => <span className="font-medium">{text}</span> }} /></p>
              <p className="text-sm text-muted-foreground">{t("unsubscribe.askHint")}</p>
              <Button disabled={saving} onClick={() => void save(true)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("unsubscribe.stop")}
              </Button>
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
