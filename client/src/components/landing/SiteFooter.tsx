import { Link } from "wouter";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@shared/legal";
import { openCookieSettings } from "@/lib/cookieConsent";
import { useSignupMode } from "@/lib/signupMode";

const COLUMNS = [
  { title: "Product", links: [["Features", "/#features"], ["How it works", "/#how"], ["Pricing", "/pricing"], ["Demo", "/demo"], ["API", "/developers"]] },
  { title: "Account", links: [["Sign in", "/login"], ["__signup__", "/request-access"], ["Settings", "/settings"]] },
  { title: "Legal", links: [["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"], ["Cookie Policy", "/cookies"], ["Refund Policy", "/refunds"], ["Credits and licences", "/credits"]] },
];

export default function SiteFooter() {
  const signup = useSignupMode();
  const columns = COLUMNS.map((column) => ({
    ...column,
    links: column.links.map(([label, href]) => (label === "__signup__" ? [signup.label, signup.href] : [label, href])),
  }));
  return (
    <footer className="border-t border-border bg-brand-mist/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs space-y-3">
          <p className="text-xl font-bold text-primary">StudyScribe AI</p>
          <p className="text-sm text-muted-foreground">Record once. Study from the transcript, the flashcards and an AI tutor.</p>
          <p className="text-sm text-muted-foreground">You can export or delete all of your data at any time from Settings.</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="space-y-3">
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {column.links.map(([label, href]) => (
                <li key={label}>
                  {href.includes("#") ? (
                    <a href={href} className="transition-colors hover:text-primary">{label}</a>
                  ) : (
                    <Link href={href} className="transition-colors hover:text-primary">{label}</Link>
                  )}
                </li>
              ))}
              {column.title === "Legal" && (
                <li>
                  <button type="button" onClick={openCookieSettings} className="transition-colors hover:text-primary">Cookie settings</button>
                </li>
              )}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-sm text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <p>&copy; 2026 {OPERATOR_NAME}. All rights reserved.</p>
          <p>
            Contact: <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-primary">{CONTACT_EMAIL}</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
