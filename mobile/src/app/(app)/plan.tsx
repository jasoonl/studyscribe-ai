import { View } from "react-native";
import { formatMinutes, getPlan } from "@shared/plans";
import { Card } from "@/components/ui/Card";
import { ErrorState, ProgressBar, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { errorMessage, trpc } from "@/lib/trpc";

/**
 * Plan and usage, read only. The app never sells or links to a purchase: no
 * prices, no upgrade buttons, no links to checkout (App Store guideline
 * 3.1.3(f) for free companion apps to a paid web service; Google Play's
 * equivalent for apps without in-app purchases). See mobile/STORE.md.
 */
export default function PlanScreen() {
  const status = trpc.billing.status.useQuery();

  if (status.isLoading) {
    return (
      <Screen edges={["bottom"]}>
        <SkeletonList rows={2} />
      </Screen>
    );
  }
  if (status.error || !status.data) {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState message={status.error ? errorMessage(status.error) : "Plan details are unavailable."} onRetry={() => status.refetch()} />
      </Screen>
    );
  }

  const data = status.data as {
    plan: { id: string; name?: string } | string;
    subscription: { description?: string | null; currentPeriodEnd?: Date | string | null; cancelAtPeriodEnd?: boolean | number | null } | null;
    usage: { enforced: boolean; minutesUsed: number; minutesLimit: number | null; generationsUsed: number; generationsLimit: number | null; resetsOn: string };
  };
  const plan = getPlan(typeof data.plan === "string" ? data.plan : data.plan.id);
  const { usage } = data;

  return (
    <Screen edges={["bottom"]}>
      <Card className="gap-1">
        <Text variant="caption">Your plan</Text>
        <Text variant="title">{plan.name}</Text>
        {data.subscription?.description ? <Text variant="muted">{data.subscription.description}</Text> : null}
      </Card>

      <Card className="gap-4">
        <Text variant="subheading">This month</Text>
        <Meter label="Transcription" used={usage.minutesUsed} limit={usage.minutesLimit} format={(value) => formatMinutes(value)} />
        <Meter label="AI study tools" used={usage.generationsUsed} limit={usage.generationsLimit} format={(value) => `${value}`} />
        <Text variant="caption">Resets on {usage.resetsOn}.</Text>
        {!usage.enforced ? <Text variant="caption">Limits are not being enforced right now.</Text> : null}
      </Card>

      <View className="rounded-xl bg-muted p-4">
        <Text variant="small" className="text-muted-foreground">
          Plan changes aren't available in the app. Your plan works the same on every device you sign in to.
        </Text>
      </View>
    </Screen>
  );
}

function Meter({ label, used, limit, format }: { label: string; used: number; limit: number | null; format: (value: number) => string }) {
  return (
    <View className="gap-2">
      <View className="flex-row justify-between">
        <Text variant="label">{label}</Text>
        <Text variant="small" className="text-muted-foreground">
          {limit === null ? `${format(used)} used` : `${format(used)} of ${format(limit)}`}
        </Text>
      </View>
      {limit !== null ? <ProgressBar value={limit > 0 ? used / limit : 0} label={`${label} used`} /> : null}
    </View>
  );
}
