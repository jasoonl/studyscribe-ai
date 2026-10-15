import { useState } from "react";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSignupMode } from "@/lib/signupMode";
import { BillingIntervalToggle } from "@/components/BillingIntervalToggle";
import { PLANS, PLAN_FEATURES, type BillingInterval, type Plan } from "@shared/plans";
import type { MessageKey } from "@shared/i18n";
import { formatNumber, t, useI18n } from "@/i18n";

/** Plan feature lines live in shared/plans.ts (the server reads them too); each maps to `pricing.feature<n>` by position. */
const FEATURE_KEYS = PLAN_FEATURES.map((_, i) => `pricing.feature${i + 1}` as MessageKey);
const TAGLINE_KEYS: Record<string, MessageKey> = {
  free: "pricing.tagline.free",
  basic: "pricing.tagline.basic",
  pro: "pricing.tagline.pro",
  max: "pricing.tagline.max",
};

function price(plan: Plan, interval: BillingInterval) {
  const amount = interval === "year" ? plan.priceYearlyUsd : plan.priceMonthlyUsd;
  return formatNumber(amount, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** "2 hours of transcription", as `formatMinutes` in shared/plans.ts words it. */
function allowance(minutes: number) {
  return minutes >= 120 && minutes % 60 === 0
    ? t("pricing.allowanceHours", { count: formatNumber(minutes / 60) })
    : t("pricing.allowanceMinutes", { count: formatNumber(minutes) });
}

export default function PricingSection({ id = "pricing", heading, headingLevel = "h2" }: { id?: string; heading?: string; headingLevel?: "h1" | "h2" }) {
  useI18n();
  const Heading = headingLevel;
  const PlanHeading = headingLevel === "h1" ? "h2" : "h3";
  const { data } = trpc.billing.plans.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const signup = useSignupMode();
  // Until the server answers, paid plans read "Coming soon", which is also what a server without billing says.
  const plans = data?.plans ?? PLANS;
  const billingEnabled = data?.billingEnabled ?? false;
  const yearlyEnabled = billingEnabled && Boolean(data?.yearlyEnabled);
  const [chosen, setChosen] = useState<BillingInterval>("month");
  const interval: BillingInterval = yearlyEnabled ? chosen : "month";
  return (
    <section id={id} className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <Heading className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{heading ?? t("pricing.heading")}</Heading>
          <p className="mt-4 text-muted-foreground">{t("pricing.intro")}</p>
          {yearlyEnabled && <BillingIntervalToggle value={interval} onChange={setChosen} className="mt-8" />}
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border p-7 ${
                plan.highlight ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card"
              }`}
            >
              <PlanHeading className="text-lg font-semibold">{plan.name}</PlanHeading>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-bold tracking-tighter">{price(plan, plan.priceMonthlyUsd === 0 ? "month" : interval)}</span>
                <span className={plan.highlight ? "text-primary-foreground/90" : "text-muted-foreground"}>{plan.priceMonthlyUsd === 0 || interval === "month" ? t("pricing.perMonth") : t("pricing.perYear")}</span>
              </p>
              <p className={`mt-3 text-sm ${plan.highlight ? "text-primary-foreground/90" : "text-muted-foreground"}`}>{TAGLINE_KEYS[plan.id] ? t(TAGLINE_KEYS[plan.id]) : plan.tagline}</p>
              <div className={`mt-5 rounded-md px-3 py-2.5 text-sm ${plan.highlight ? "bg-white/10" : "bg-brand-mist"}`}>
                <p className={`text-xs ${plan.highlight ? "text-primary-foreground" : "text-muted-foreground"}`}>{t("pricing.eachMonth")}</p>
                <p className="mt-0.5 font-medium">{allowance(plan.transcriptionMinutesPerMonth)}</p>
                <p className="font-medium">{t("pricing.generations", { count: formatNumber(plan.aiGenerationsPerMonth) })}</p>
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {FEATURE_KEYS.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? "text-primary-foreground" : "text-primary"}`} strokeWidth={3} />
                    {t(feature)}
                  </li>
                ))}
              </ul>
              {plan.purchasable ? (
                <Link
                  href={plan.priceMonthlyUsd === 0 ? signup.href : `/billing?plan=${plan.id}${interval === "year" ? "&interval=year" : ""}`}
                  className={`mt-8 block rounded-md px-5 py-3 text-center text-sm font-semibold transition-[filter,transform] hover:brightness-110 active:scale-[0.98] ${
                    plan.highlight ? "bg-background text-primary" : "bg-primary text-primary-foreground"
                  }`}
                >
                  {plan.priceMonthlyUsd === 0 ? signup.label : t("pricing.choose", { plan: plan.name })}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={`mt-8 block cursor-not-allowed rounded-md border px-5 py-3 text-center text-sm font-semibold ${
                    plan.highlight ? "border-white/30 text-primary-foreground/90" : "border-border text-muted-foreground"
                  }`}
                >
                  {t("pricing.comingSoon")}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          {billingEnabled
            ? yearlyEnabled
              ? t("pricing.noteYearly")
              : t("pricing.noteMonthly")
            : t("pricing.noteOff")}{" "}
          <Link href="/refunds" className="font-medium text-primary underline underline-offset-2">{t("footer.refunds")}</Link>
        </p>
      </div>
    </section>
  );
}
