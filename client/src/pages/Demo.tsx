import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useSignupMode } from "@/lib/signupMode";
import { useI18n } from "@/i18n";
import PublicLayout from "@/components/landing/PublicLayout";
import DemoWalkthrough, { DEMO_SLIDES } from "@/components/DemoWalkthrough";

export default function Demo() {
  const signup = useSignupMode();
  const { t } = useI18n();
  return (
    <PublicLayout>
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">
          {t("demo.title")}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          {t("demo.intro")}
        </p>

        <div className="shadow-apple mt-12 overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-6">
          <DemoWalkthrough />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{t("demo.credit")}</p>
      </section>

      <section id="tour" className="scroll-mt-24 border-t border-border bg-brand-mist/50">
        <div className="mx-auto grid max-w-5xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-balance text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{t("demo.tourTitle")}</h2>
            <p className="mt-4 text-muted-foreground">{t("demo.tourIntro")}</p>
          </div>
          <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {DEMO_SLIDES.map((slide, i) => (
              <li key={slide.image} className="flex gap-4">
                <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block font-semibold">{t(slide.title)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(slide.caption)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-4 py-20 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-balance text-3xl font-bold tracking-[-0.03em]">{t("demo.tryTitle")}</h2>
          <p className="mt-2 text-muted-foreground">
            {signup.open ? t("demo.tryOpen") : t("demo.tryClosed")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link
            href={signup.href}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
          >
            {signup.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/login" className="inline-flex items-center whitespace-nowrap rounded-md border border-border px-6 py-3 text-sm font-semibold hover:bg-secondary">
            {t("common.signIn")}
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
