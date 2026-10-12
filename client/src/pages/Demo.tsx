import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import PublicLayout from "@/components/landing/PublicLayout";
import DemoWalkthrough, { DEMO_SLIDES } from "@/components/DemoWalkthrough";

export default function Demo() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">
          Watch one lecture go from recording to study guide
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Every screen below is the real app: a recording is added, transcribed with speaker labels, and turned into notes, flashcards, a quiz and a study guide.
        </p>

        <div className="shadow-apple mt-12 overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-6">
          <DemoWalkthrough />
        </div>
      </section>

      <section className="border-t border-border bg-brand-mist/50">
        <div className="mx-auto grid max-w-5xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-balance text-3xl font-bold tracking-[-0.03em] sm:text-4xl">What the tour covers</h2>
            <p className="mt-4 text-muted-foreground">In the order you would use it after a lecture.</p>
          </div>
          <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {DEMO_SLIDES.map((slide, i) => (
              <li key={slide.title} className="flex gap-4">
                <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block font-semibold">{slide.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{slide.caption}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-4 py-20 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-balance text-3xl font-bold tracking-[-0.03em]">Try it on your own lecture</h2>
          <p className="mt-2 text-muted-foreground">StudyScribe is invite-only for now. Ask for access and we will email you a code.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link
            href="/request-access"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
          >
            Request access
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/login" className="inline-flex items-center whitespace-nowrap rounded-md border border-border px-6 py-3 text-sm font-semibold hover:bg-secondary">
            Sign in
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
