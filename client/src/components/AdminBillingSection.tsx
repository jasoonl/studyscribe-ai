import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";

/** Admin page: whether billing is set up (F2) and the open sign-up switch (F4). */
export function AdminBillingSection() {
  const utils = trpc.useUtils();
  const { data: billing } = trpc.diagnostics.billing.useQuery(undefined, { refetchOnWindowFocus: false });
  const { data: signup } = trpc.signup.adminStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const setOpen = trpc.signup.setOpenSignup.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.signup.adminStatus.invalidate(), utils.signup.mode.invalidate()]);
      toast.success(result.openSignup ? "Anyone can now sign up for the Free plan" : "Sign-up is invite-only again");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      {billing && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Billing</h2>
          <Card className="gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={billing.configured ? "default" : "outline"}>{billing.configured ? `Stripe ${billing.mode ?? ""} mode` : "Not configured"}</Badge>
              <Badge variant={billing.secretKey ? "default" : "destructive"}>Secret key {billing.secretKey ? "set" : "missing"}</Badge>
              <Badge variant={billing.webhookSecret ? "default" : "destructive"}>Webhook secret {billing.webhookSecret ? "set" : "missing"}</Badge>
              {([["basic", "Basic"], ["pro", "Pro"], ["max", "Max"]] as const).map(([plan, name]) => (
                <Badge key={plan} variant={billing.prices[plan] ? "default" : "destructive"}>
                  {name} price {billing.prices[plan] ? "set" : "missing"}
                </Badge>
              ))}
              <Badge variant="outline">Automatic tax {billing.automaticTax ? "on" : "off"}</Badge>
              <Badge variant="outline">Yearly prices {billing.yearly ? "on" : "off"}</Badge>
              {billing.usingTestApi && <Badge variant="outline">Mock Stripe API</Badge>}
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {billing.webhookUrl ? (
                <>Stripe webhook endpoint: <span className="font-mono">{billing.webhookUrl}</span></>
              ) : (
                "Set PUBLIC_APP_URL to see the webhook endpoint to give Stripe."
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {billing.configured
                ? `Paid plans are on sale and monthly limits are enforced. Paying subscribers: ${billing.subscribers.basic} Basic, ${billing.subscribers.pro} Pro, ${billing.subscribers.max} Max.`
                : billing.limitsForcedOn
                  ? "Paid plans say Coming soon. USAGE_LIMITS_ENFORCED is on, so everyone is held to the Free plan's limits."
                  : "Paid plans say Coming soon and no usage limits are enforced. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_BASIC, _PRO and _MAX to start selling."}
              {!billing.tablesReady && " The billing tables are missing: run npm run db:migrate (migration 0023)."}
            </p>
          </Card>
        </section>
      )}

      {signup && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sign-up</h2>
          <Card className="gap-3 p-5">
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="open-signup" className="text-sm font-medium">Open sign-up</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Anyone can create a Free account without an invite. Invite codes keep working. At most 5 accounts an hour from one network, and new open sign-ups pause for the day after {signup.dailyCap} accounts in 24 hours ({signup.signupsLast24h} so far).{" "}
                  {signup.emailConfirmation ? "New accounts confirm their email before transcribing." : "Email confirmation is off because Resend is not configured."}
                </p>
                {!signup.canEnable && !signup.openSignup && <p className="mt-2 text-xs font-medium text-destructive">{signup.reason}</p>}
              </div>
              <Switch
                id="open-signup"
                checked={signup.openSignup}
                disabled={setOpen.isPending || (!signup.canEnable && !signup.openSignup)}
                onCheckedChange={(checked) => setOpen.mutate({ enabled: checked })}
              />
            </div>
          </Card>
        </section>
      )}
    </>
  );
}
