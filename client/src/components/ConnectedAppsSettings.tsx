import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { connectIntegrationUrl } from "@/components/SendToMenu";
import { trpc } from "@/lib/trpc";
import { useI18n, t } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

const NAMES = { notion: "Notion", google: "Google Docs", "google-calendar": "Google Calendar" } as const;
const REASONS: Record<string, MessageKey> = {
  not_configured: "settingsCards.apps.failNotConfigured",
  denied: "settingsCards.apps.failDenied",
  state: "settingsCards.apps.failState",
  exchange: "settingsCards.apps.failExchange",
};

/** Notion and Google Docs connections (E3) in Settings. */
export function ConnectedAppsSettings() {
  useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.integrations.status.useQuery();
  const disconnect = trpc.integrations.disconnect.useMutation({
    onSuccess: async () => {
      await utils.integrations.status.invalidate();
      toast.success(t("settingsCards.apps.disconnected"));
    },
    onError: error => toast.error(error.message),
  });

  // The OAuth callback sends people back here with the result in the query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const which = params.get("integration") as keyof typeof NAMES | null;
    const status = params.get("status");
    if (!which || !NAMES[which] || !status) return;
    if (status === "connected") toast.success(t("settingsCards.apps.nowConnected", { app: NAMES[which] }));
    else toast.error(t(REASONS[params.get("reason") ?? ""] ?? "settingsCards.apps.failOther", { app: NAMES[which] }));
    window.history.replaceState(null, "", `${window.location.pathname}#connected-apps`);
    document.getElementById("connected-apps")?.scrollIntoView();
  }, []);

  const rows = data
    ? [
        { key: "notion" as const, provider: "notion" as const, info: data.notion, what: t("settingsCards.apps.whatNotion") },
        { key: "google" as const, provider: "google_drive" as const, info: data.google, what: t("settingsCards.apps.whatGoogle") },
        { key: "google-calendar" as const, provider: "google_calendar" as const, info: data.calendar, what: t("settingsCards.apps.whatCalendar") },
      ]
    : [];

  return (
    <Card className="scroll-mt-6 p-6" id="connected-apps">
      <h2 className="text-lg font-semibold">{t("settingsCards.apps.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settingsCards.apps.intro")}</p>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && !data.available ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("settingsCards.apps.notAvailable")}</p>
      ) : (
        <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
          {rows.map(row => (
            <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{NAMES[row.key]}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {!row.info.configured
                    ? t("settingsCards.apps.notSetUp")
                    : row.info.connected
                      ? row.info.accountLabel
                        ? t("settingsCards.apps.connectedTo", { account: row.info.accountLabel })
                        : t("settingsCards.apps.connected")
                      : row.what}
                </p>
              </div>
              {row.info.configured &&
                (row.info.connected ? (
                  <Button variant="outline" size="sm" disabled={disconnect.isPending} onClick={() => disconnect.mutate({ provider: row.provider })}>
                    {t("settingsCards.apps.disconnect")}
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a href={connectIntegrationUrl(row.provider)}>{t("settingsCards.apps.connect")}</a>
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
