import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/** For open sign-ups that have not confirmed their email yet (F4): explains why recording is held, and resends the link. */
export function EmailConfirmationBanner() {
  const { data, refetch } = trpc.signup.confirmation.useQuery(undefined, { refetchOnWindowFocus: true });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") !== "1") return;
    toast.success("Your email is confirmed. You're all set.");
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
      if (!response.ok) throw new Error(body.error || "The email could not be sent");
      toast.success(body.alreadyConfirmed ? "Your email is already confirmed." : `Sent. Check ${data.email}, and your spam folder.`);
      if (body.alreadyConfirmed) void refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The email could not be sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-border bg-brand-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        <span className="font-medium">Confirm your email to start transcribing.</span>{" "}
        <span className="text-muted-foreground">We sent a link to {data.email}.</span>
      </p>
      <Button size="sm" variant="outline" onClick={resend} disabled={sending} className="shrink-0 bg-background">
        {sending ? "Sending" : "Send the link again"}
      </Button>
    </div>
  );
}
