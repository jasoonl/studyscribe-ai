import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

/** Settings: the person's team, or how to start one (F3). Hidden when teams are not set up here. */
export function TeamSettingsCard() {
  const { t } = useI18n();
  const { data } = trpc.teams.mine.useQuery();
  if (!data?.available) return null;
  return (
    <Card className="gap-0 p-6" id="team">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{t("team.title")}</h2>
        <Link href="/team" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{data.org ? t("team.settings.open") : t("team.start.title")}</Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.org
          ? t(data.org.subscription.active ? `team.settings.${data.org.role}Plan` : `team.settings.${data.org.role}`, { team: data.org.name })
          : t("team.settings.pitch")}
      </p>
    </Card>
  );
}
