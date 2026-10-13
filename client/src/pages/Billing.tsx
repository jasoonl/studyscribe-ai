import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UsageMeters } from "@/components/UsageMeters";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatMinutes, formatPlanPrice, isPaidPlanId, type PaidPlanId } from "@shared/plans";

export default function Billing() {
  const { user } = useAuth();
  const plansQuery = trpc.billing.plans.useQuery();
  const [waitingForStripe, setWaitingForStripe] = useState(false);
  const status = trpc.billing.status.useQuery(undefined, { refetchInterval: waitingForStripe ? 2000 : false });
  const checkout = trpc.billing.checkout.useMutation();
  const portal = trpc.billing.portal.useMutation();
  const [pendingPlan, setPendingPlan] = useState<PaidPlanId | null>(null);
  const handledParams = useRef(false);

  // Back from Stripe: say what happened, and refresh until the webhook has landed.
  useEffect(() => {
    if (handledParams.current) return;
    handledParams.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast.success("Payment received. Your plan will show here in a moment.");
      setWaitingForStripe(true);
      window.setTimeout(() => setWaitingForStripe(false), 30_000);
    } else if (params.get("checkout") === "cancelled") {
      toast("Checkout cancelled. Nothing was charged.");
    } else if (params.get("cancelled") === "1") {
      toast.success("Your plan is cancelled. You keep it until the end of the period you paid for.");
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
      const { url } = await checkout.mutateAsync({ plan });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start checkout");
      setPendingPlan(null);
    }
  };

  const openPortal = async (intent: "manage" | "cancel") => {
    try {
      const { url } = await portal.mutateAsync({ intent });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the billing portal");
    }
  };

  const data = status.data;
  const plans = plansQuery.data?.plans ?? [];
  const billingEnabled = plansQuery.data?.billingEnabled ?? false;
  const live = data?.subscription?.live ?? false;
  const currentPlanId = data?.plan.id ?? "free";

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />Dashboard</Button>
          </Link>
          <h1 className="text-lg font-semibold">Billing</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        {status.isLoading || plansQuery.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data ? (
          <Card className="p-6"><p className="text-sm text-muted-foreground">Billing could not be loaded. Refresh the page to try again.</p></Card>
        ) : (
          <>
            <Card className="gap-0 p-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">{data.plan.name} plan</h2>
                <p className="text-sm text-muted-foreground">
                  {data.plan.priceMonthlyUsd === 0 ? "Free" : `${formatPlanPrice(data.plan)} a month, plus any tax`}
                </p>
              </div>
              {data.subscription?.description && (
                <p className={cn("mt-2 text-sm", data.subscription.status === "past_due" || data.subscription.status === "unpaid" ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {data.subscription.description}
                </p>
              )}
              {waitingForStripe && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking with Stripe</p>
              )}

              <div className="mt-6 border-t border-border pt-6">
                <h3 className="sr-only">This month</h3>
                <UsageMeters usage={data.usage} isAdmin={user?.role === "admin"} />
              </div>

              {data.subscription && billingEnabled && (
                <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row">
                  <Button variant="outline" onClick={() => openPortal("manage")} disabled={portal.isPending} className="gap-2">
                    {live ? "Change plan or card" : "Invoices and payment details"}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  {live && !data.subscription.cancelAtPeriodEnd && (
                    <Button variant="outline" onClick={() => openPortal("cancel")} disabled={portal.isPending}>
                      Cancel plan
                    </Button>
                  )}
                </div>
              )}
            </Card>

            <section aria-labelledby="plans-heading">
              <h2 id="plans-heading" className="mb-3 text-sm font-semibold">Plans</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {plans.map(plan => {
                  const current = plan.id === currentPlanId;
                  const paid = isPaidPlanId(plan.id);
                  return (
                    <li key={plan.id} id={`plan-${plan.id}`} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2">
                          <span className="font-semibold">{plan.name}</span>
                          <span className="text-sm tabular-nums text-muted-foreground">{formatPlanPrice(plan)} / month</span>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatMinutes(plan.transcriptionMinutesPerMonth)} of transcription and {plan.aiGenerationsPerMonth.toLocaleString("en-US")} AI generations a month
                        </p>
                      </div>
                      <div className="shrink-0">
                        {current ? (
                          <span className="text-sm font-medium text-muted-foreground">Current plan</span>
                        ) : !paid ? null : !plan.purchasable ? (
                          <span className="text-sm text-muted-foreground">Coming soon</span>
                        ) : live ? (
                          <Button variant="outline" size="sm" onClick={() => openPortal("manage")} disabled={portal.isPending}>
                            Switch to {plan.name}
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => paid && startCheckout(plan.id as PaidPlanId)} disabled={checkout.isPending}>
                            {pendingPlan === plan.id ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening checkout</> : `Choose ${plan.name}`}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {billingEnabled
                  ? "Prices are in US dollars per month. Checkout, run by Stripe, shows the full price including any tax before you pay. Plans renew every month until you cancel. You can cancel here at any time and keep the plan until the end of the period you paid for. When you switch plans, Stripe shows what changes before you confirm."
                  : "Paid plans are not on sale yet. Everyone is on the Free plan in the meantime."}{" "}
                <Link href="/refunds" className="font-medium text-primary underline-offset-2 hover:underline">Refund Policy</Link>
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
