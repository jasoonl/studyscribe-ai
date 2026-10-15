import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UsageMeters } from "@/components/UsageMeters";
import { BillingIntervalToggle } from "@/components/BillingIntervalToggle";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n, t, tn, formatNumber } from "@/i18n";
import { isPaidPlanId, type BillingInterval, type PaidPlanId, type Plan } from "@shared/plans";

function planPrice(plan: Plan, interval: BillingInterval = "month") {
  const amount = interval === "year" ? plan.priceYearlyUsd : plan.priceMonthlyUsd;
  return formatNumber(amount, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function allowanceMinutes(minutes: number) {
  if (minutes >= 120 && minutes % 60 === 0) return t("billing.hours", { hours: formatNumber(minutes / 60) });
  return tn("billing.minutes", minutes);
}

export default function Billing() {
  useI18n();
  const { user } = useAuth();
  const plansQuery = trpc.billing.plans.useQuery();
  const [waitingForStripe, setWaitingForStripe] = useState(false);
  const status = trpc.billing.status.useQuery(undefined, { refetchInterval: waitingForStripe ? 2000 : false });
  const checkout = trpc.billing.checkout.useMutation();
  const portal = trpc.billing.portal.useMutation();
  const [pendingPlan, setPendingPlan] = useState<PaidPlanId | null>(null);
  const [chosenInterval, setChosenInterval] = useState<BillingInterval>(() => {
    try {
      return new URLSearchParams(window.location.search).get("interval") === "year" ? "year" : "month";
    } catch {
      return "month";
    }
  });
  const handledParams = useRef(false);

  // Back from Stripe: say what happened, and refresh until the webhook has landed.
  useEffect(() => {
    if (handledParams.current) return;
    handledParams.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast.success(t("billing.checkoutSuccess"));
      setWaitingForStripe(true);
      window.setTimeout(() => setWaitingForStripe(false), 30_000);
    } else if (params.get("checkout") === "cancelled") {
      toast(t("billing.checkoutCancelled"));
    } else if (params.get("cancelled") === "1") {
      toast.success(t("billing.cancelled"));
      setWaitingForStripe(true);
      window.setTimeout(() => setWaitingForStripe(false), 15_000);
    }
    const wanted = params.get("plan");
    if (wanted && isPaidPlanId(wanted)) document.getElementById(`plan-${wanted}`)?.scrollIntoView({ block: "center" });
    if (params.toString()) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (waitingForStripe && status.data?.plan.id !== "free" && status.data?.subscription?.live) setWaitingForStripe(false);
  }, [waitingForStripe, status.data]);

  const startCheckout = async (plan: PaidPlanId) => {
    setPendingPlan(plan);
    try {
      const { url } = await checkout.mutateAsync({ plan, interval });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("billing.checkoutFailed"));
      setPendingPlan(null);
    }
  };

  const openPortal = async (intent: "manage" | "cancel") => {
    try {
      const { url } = await portal.mutateAsync({ intent });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("billing.portalFailed"));
    }
  };

  const data = status.data;
  const plans = plansQuery.data?.plans ?? [];
  const billingEnabled = plansQuery.data?.billingEnabled ?? false;
  const live = data?.subscription?.live ?? false;
  const currentPlanId = data?.plan.id ?? "free";
  const yearlyEnabled = billingEnabled && Boolean(plansQuery.data?.yearlyEnabled);
  const interval: BillingInterval = yearlyEnabled ? chosenInterval : "month";

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />{t("common.library")}</Button>
          </Link>
          <h1 className="text-lg font-semibold">{t("billing.title")}</h1>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl space-y-6 px-4 py-10 focus:outline-none">
        {status.isLoading || plansQuery.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data ? (
          <Card className="p-6"><p className="text-sm text-muted-foreground">{t("billing.loadFailed")}</p></Card>
        ) : (
          <>
            <Card className="gap-0 p-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">{t("billing.planName", { plan: data.plan.name })}</h2>
                <p className="text-sm text-muted-foreground">
                  {data.plan.priceMonthlyUsd === 0
                    ? t("billing.freePrice", { price: planPrice(data.plan) })
                    : data.subscription?.interval === "year"
                      ? t("billing.pricePerYearTax", { price: planPrice(data.plan, "year") })
                      : t("billing.pricePerMonthTax", { price: planPrice(data.plan) })}
                </p>
              </div>
              {data.subscription?.description && (
                <p className={cn("mt-2 text-sm", data.subscription.status === "past_due" || data.subscription.status === "unpaid" ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {data.subscription.description}
                </p>
              )}
              {waitingForStripe && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("billing.checkingStripe")}</p>
              )}

              <div className="mt-6 border-t border-border pt-6">
                <h3 className="sr-only">{t("billing.thisMonth")}</h3>
                <UsageMeters usage={data.usage} isAdmin={user?.role === "admin"} />
              </div>

              {data.subscription && billingEnabled && (
                <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row">
                  <Button variant="outline" onClick={() => openPortal("manage")} disabled={portal.isPending} className="gap-2">
                    {live ? t("billing.changePlan") : t("billing.invoices")}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  {live && !data.subscription.cancelAtPeriodEnd && (
                    <Button variant="outline" onClick={() => openPortal("cancel")} disabled={portal.isPending}>
                      {t("billing.cancelPlan")}
                    </Button>
                  )}
                </div>
              )}
            </Card>

            <section aria-labelledby="plans-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 id="plans-heading" className="text-sm font-semibold">{t("billing.plans")}</h2>
                {yearlyEnabled && !live && <BillingIntervalToggle value={interval} onChange={setChosenInterval} />}
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {plans.map(plan => {
                  const current = plan.id === currentPlanId;
                  const paid = isPaidPlanId(plan.id);
                  return (
                    <li key={plan.id} id={`plan-${plan.id}`} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2">
                          <span className="font-semibold">{plan.name}</span>
                          <span className="text-sm tabular-nums text-muted-foreground">
                            {t(paid && interval === "year" ? "billing.priceYear" : "billing.priceMonth", { price: planPrice(plan, paid ? interval : "month") })}
                          </span>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t("billing.allowance", { minutes: allowanceMinutes(plan.transcriptionMinutesPerMonth), generations: formatNumber(plan.aiGenerationsPerMonth) })}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {current ? (
                          <span className="text-sm font-medium text-muted-foreground">{t("billing.currentPlan")}</span>
                        ) : !paid ? null : !plan.purchasable ? (
                          <span className="text-sm text-muted-foreground">{t("billing.comingSoon")}</span>
                        ) : live ? (
                          <Button variant="outline" size="sm" onClick={() => openPortal("manage")} disabled={portal.isPending}>
                            {t("billing.switchTo", { plan: plan.name })}
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => paid && startCheckout(plan.id as PaidPlanId)} disabled={checkout.isPending}>
                            {pendingPlan === plan.id ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("billing.openingCheckout")}</> : t("billing.choose", { plan: plan.name })}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {billingEnabled
                  ? t(yearlyEnabled ? "billing.termsYearly" : "billing.termsMonthly")
                  : t("billing.notOnSale")}{" "}
                <Link href="/refunds" className="font-medium text-primary underline-offset-2 hover:underline">{t("billing.refundPolicy")}</Link>
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
