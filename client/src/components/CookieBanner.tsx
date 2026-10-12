import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { COOKIE_SETTINGS_EVENT, needsConsentChoice, saveConsent, type ConsentChoice } from "@/lib/cookieConsent";

/**
 * Asks once whether analytics may run. Decline and Accept are the same size and style, and
 * "Cookie settings" in the footer reopens this to change the answer.
 */
export default function CookieBanner() {
  const [open, setOpen] = useState(needsConsentChoice);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, show);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, show);
  }, []);

  if (!open) return null;

  const choose = (choice: ConsentChoice) => {
    const needsReload = saveConsent(choice);
    setOpen(false);
    if (needsReload) window.location.reload();
  };

  return (
    <section aria-label="Cookie preferences" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] p-4 sm:p-6">
      <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-lg sm:flex-row sm:items-center sm:gap-6">
        <p className="flex-1 text-sm text-muted-foreground">
          We use one essential cookie to keep you signed in. With your permission, we also count page visits with
          cookie-free analytics. Nothing is tracked across other sites.{" "}
          <Link href="/cookies" className="font-medium text-primary underline underline-offset-2">Cookie Policy</Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => choose("declined")}>Decline</Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => choose("accepted")}>Accept</Button>
        </div>
      </div>
    </section>
  );
}
