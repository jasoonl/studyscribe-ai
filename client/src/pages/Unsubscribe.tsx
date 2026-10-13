import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import PublicLayout from "@/components/landing/PublicLayout";
import { Button } from "@/components/ui/button";
import { ContactEmail } from "@/components/LegalLayout";

type State = { kind: "loading" } | { kind: "invalid" } | { kind: "ready"; email: string; optedOut: boolean } | { kind: "error"; message: string };

/**
 * "Don't email me from StudyScribe" (D4). The link in every email that was not
 * asked for by its recipient (such as notes a meeting organiser sent) opens
 * this page; the choice is saved with a button press, so link scanners that
 * open the page do not unsubscribe anyone. Mail clients' one-click
 * unsubscribe POSTs to the same endpoint directly.
 */
export default function Unsubscribe() {
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
      .catch(() => setState({ kind: "error", message: "We could not load this page. Try again in a moment." }));
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
      if (!response.ok) throw new Error(body.error || "We could not save that.");
      setState({ kind: "ready", email: body.email, optedOut: body.optedOut });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "We could not save that." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PublicLayout>
      <section className="mx-auto max-w-xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Email from StudyScribe</h1>
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          {state.kind === "loading" ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : state.kind === "invalid" ? (
            <p className="text-muted-foreground">This link is not valid. If you keep getting email you did not ask for, write to <ContactEmail subject="Stop emails" /> and we will stop it.</p>
          ) : state.kind === "error" ? (
            <p className="text-muted-foreground" role="alert">{state.message}</p>
          ) : state.optedOut ? (
            <div className="space-y-4">
              <p className="font-medium" role="status">Done. StudyScribe will not email {state.email} again.</p>
              <p className="text-sm text-muted-foreground">
                This covers notes and invitations that StudyScribe users send through us. If you have a StudyScribe account, emails you ask for yourself, such as a password reset, still arrive.
              </p>
              <Button variant="outline" disabled={saving} onClick={() => void save(false)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Undo, I want these emails"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p>Stop all email from StudyScribe to <span className="font-medium">{state.email}</span>?</p>
              <p className="text-sm text-muted-foreground">People who use StudyScribe will no longer be able to send you meeting notes or invitations through it.</p>
              <Button disabled={saving} onClick={() => void save(true)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Don't email me from StudyScribe"}
              </Button>
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
