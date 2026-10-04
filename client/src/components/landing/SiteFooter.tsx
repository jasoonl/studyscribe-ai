import { Link } from "wouter";
import { CONTACT_EMAIL } from "@/lib/legal";

const COLUMNS = [
  { title: "Product", links: [["Features", "/#features"], ["How it works", "/#how"], ["Pricing", "/pricing"], ["Demo", "/demo"]] },
  { title: "Account", links: [["Sign in", "/login"], ["Get started", "/request-access"], ["Settings", "/settings"]] },
  { title: "Legal", links: [["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"]] },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-brand-mist/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs space-y-3">
          <p className="bg-gradient-to-r from-primary to-brand-sky bg-clip-text text-xl font-bold text-transparent">StudyScribe AI</p>
          <p className="text-sm text-muted-foreground">Record once. Study from the transcript, the flashcards and an AI tutor.</p>
          <p className="text-sm text-muted-foreground">You can export or delete all of your data at any time from Settings.</p>
        </div>
        {COLUMNS.map((column) => (
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
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-sm text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <p>&copy; 2026 StudyScribe AI</p>
          {CONTACT_EMAIL && <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-primary">{CONTACT_EMAIL}</a>}
        </div>
      </div>
    </footer>
  );
}
