import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useSignupMode } from "@/lib/signupMode";
import { Trans, useI18n } from "@/i18n";

export default function Hero() {
  const signup = useSignupMode();
  const { t } = useI18n();
  return (
    <section className="relative pb-24 pt-36 sm:pt-44">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-balance text-5xl font-bold leading-[1.03] tracking-[-0.04em] sm:text-7xl lg:text-8xl">
            <Trans k="landing.hero.title" parts={{ accent: (text) => <span className="text-primary">{text}</span> }} />
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-pretty text-xl leading-snug text-muted-foreground sm:text-2xl">
            {t("landing.hero.text")}
          </p>
          <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={signup.href}
              className="group inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
            >
              {signup.label}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-5 py-3.5 text-base font-medium text-primary hover:underline"
            >
              {t("landing.watchDemo")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-20 max-w-6xl">
          <div className="shadow-apple overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-4 py-3" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
            </div>
            <img src="/landing/dashboard.jpg" alt={t("landing.hero.alt")} className="block w-full" width={1600} height={896} fetchPriority="high" />
          </div>
        </div>
      </div>
    </section>
  );
}
