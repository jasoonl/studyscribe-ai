import type { ReactNode } from "react";
import { LEGAL_EFFECTIVE_DATE } from "@shared/legal";
import PublicLayout from "./landing/PublicLayout";

export type LegalSection = { heading: string; body: ReactNode };

export default function LegalLayout({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Effective {LEGAL_EFFECTIVE_DATE}</p>
        <div className="mt-6 space-y-4 text-muted-foreground">{intro}</div>
        <nav aria-label="On this page" className="mt-8 rounded-2xl border border-border bg-brand-mist/60 p-5">
          <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
            {sections.map((section, i) => (
              <li key={section.heading}>
                <a href={`#s${i + 1}`} className="text-primary hover:underline">{i + 1}. {section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-10 space-y-10">
          {sections.map((section, i) => (
            <section key={section.heading} id={`s${i + 1}`} className="scroll-mt-28">
              <h2 className="text-xl font-semibold tracking-tight">{i + 1}. {section.heading}</h2>
              <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </PublicLayout>
  );
}
