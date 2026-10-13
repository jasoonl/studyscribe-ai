import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { ORG_ROLE_LABELS } from "@shared/organizations";

/** Settings: the person's team, or how to start one (F3). Hidden when teams are not set up here. */
export function TeamSettingsCard() {
  const { data } = trpc.teams.mine.useQuery();
  if (!data?.available) return null;
  return (
    <Card className="gap-0 p-6" id="team">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">Team</h2>
        <Link href="/team" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{data.org ? "Open team" : "Start a team"}</Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.org
          ? `You are ${ORG_ROLE_LABELS[data.org.role].toLowerCase()} of ${data.org.name}${data.org.subscription.active ? ", on the Team plan" : ""}.`
          : "Share courses with a class, lab or company in one library, with seats, usage and sign-in managed by the team's admins."}
      </p>
    </Card>
  );
}
