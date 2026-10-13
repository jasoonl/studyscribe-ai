import { Link } from "wouter";
import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSignupMode } from "@/lib/signupMode";
import { PLANS, PLAN_FEATURES, describeAllowance, describeGenerations, formatPlanPrice } from "@shared/plans";

export default function PricingSection({ id = "pricing", heading = "Simple pricing that grows with your course load" }: { id?: string; heading?: string }) {
  const { data } = trpc.billing.plans.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const signup = useSignupMode();
  // Until the server answers, paid plans read "Coming soon", which is also what a server without billing says.
  const plans = data?.plans ?? PLANS;
  const billingEnabled = data?.billingEnabled ?? false;
  return (
    <section id={id} className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{heading}</h2>
          <p className="mt-4 text-muted-foreground">Every plan includes the full toolkit. Higher plans allow more transcription and more AI help each month.</p>
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border p-7 ${
                plan.highlight ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card"
              }`}
            >
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-bold tracking-tighter">{formatPlanPrice(plan)}</span>
                <span className={plan.highlight ? "text-primary-foreground/70" : "text-muted-foreground"}>/ month</span>
              </p>
              <p className={`mt-3 text-sm ${plan.highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{plan.tagline}</p>
              <div className={`mt-5 rounded-md px-3 py-2.5 text-sm ${plan.highlight ? "bg-white/10" : "bg-brand-mist"}`}>
                <p className={`text-xs ${plan.highlight ? "text-primary-foreground/75" : "text-muted-foreground"}`}>Each month</p>
                <p className="mt-0.5 font-medium">{describeAllowance(plan)}</p>
                <p className="font-medium">{describeGenerations(plan)}</p>
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {PLAN_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? "text-primary-foreground" : "text-primary"}`} strokeWidth={3} />
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.purchasable ? (
                <Link
                  href={plan.priceMonthlyUsd === 0 ? signup.href : `/billing?plan=${plan.id}`}
                  className={`mt-8 block rounded-md px-5 py-3 text-center text-sm font-semibold transition-[filter,transform] hover:brightness-110 active:scale-[0.98] ${
                    plan.highlight ? "bg-background text-primary" : "bg-primary text-primary-foreground"
                  }`}
                >
                  {plan.priceMonthlyUsd === 0 ? signup.label : `Choose ${plan.name}`}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={`mt-8 block cursor-not-allowed rounded-md border px-5 py-3 text-center text-sm font-semibold ${
                    plan.highlight ? "border-white/30 text-primary-foreground/80" : "border-border text-muted-foreground"
                  }`}
                >
                  Coming soon
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          {billingEnabled
            ? "Prices are in US dollars per month. Checkout, run by Stripe, shows the full price including any tax before you pay. Paid plans renew every month until you cancel, and you can cancel any time from Billing. No setup or hidden fees."
            : "Prices are in US dollars per month. Paid plans are not on sale yet. When they are, checkout will show the full price, including any tax, before you pay. No setup or hidden fees, and you can cancel any time."}{" "}
          <Link href="/refunds" className="font-medium text-primary underline underline-offset-2">Refund Policy</Link>
        </p>
      </div>
    </section>
  );
}
