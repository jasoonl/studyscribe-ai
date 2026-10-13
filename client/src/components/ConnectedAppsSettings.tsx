import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { connectIntegrationUrl } from "@/components/SendToMenu";
import { trpc } from "@/lib/trpc";

const NAMES = { notion: "Notion", google: "Google Docs", "google-calendar": "Google Calendar" } as const;
const REASONS: Record<string, string> = {
  not_configured: "is not set up on this server.",
  denied: "was not connected: access was not granted.",
  state: "was not connected: the sign-in expired or came from another session. Try again.",
  exchange: "was not connected: the provider did not accept the sign-in. Try again.",
};

/** Notion and Google Docs connections (E3) in Settings. */
export function ConnectedAppsSettings() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.integrations.status.useQuery();
  const disconnect = trpc.integrations.disconnect.useMutation({
    onSuccess: async () => {
      await utils.integrations.status.invalidate();
      toast.success("Disconnected");
    },
    onError: error => toast.error(error.message),
  });

  // The OAuth callback sends people back here with the result in the query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const which = params.get("integration") as keyof typeof NAMES | null;
    const status = params.get("status");
    if (!which || !NAMES[which] || !status) return;
    if (status === "connected") toast.success(`${NAMES[which]} is connected`);
    else toast.error(`${NAMES[which]} ${REASONS[params.get("reason") ?? ""] ?? "could not be connected."}`);
    window.history.replaceState(null, "", `${window.location.pathname}#connected-apps`);
    document.getElementById("connected-apps")?.scrollIntoView();
  }, []);

  const rows = data
    ? [
        { key: "notion" as const, provider: "notion" as const, info: data.notion, what: "Send notes and study guides as new pages under a page you choose." },
        { key: "google" as const, provider: "google_drive" as const, info: data.google, what: "Send notes and study guides as Google Docs. StudyScribe can only see the files it creates." },
        { key: "google-calendar" as const, provider: "google_calendar" as const, info: data.calendar, what: "See the next week's classes on your dashboard, get a reminder to record, and name recordings after the event. Read only." },
      ]
    : [];

  return (
    <Card className="scroll-mt-6 p-6" id="connected-apps">
      <h2 className="text-lg font-semibold">Connected apps</h2>
      <p className="mt-1 text-sm text-muted-foreground">Copy your study material into the tools you already use, and bring in your class schedule. You can disconnect at any time, which deletes the stored access.</p>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && !data.available ? (
        <p className="mt-4 text-sm text-muted-foreground">Connected apps are not available on this server yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
          {rows.map(row => (
            <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{NAMES[row.key]}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {!row.info.configured
                    ? "Not set up on this server yet."
                    : row.info.connected
                      ? `Connected${row.info.accountLabel ? ` to ${row.info.accountLabel}` : ""}.`
                      : row.what}
                </p>
              </div>
              {row.info.configured &&
                (row.info.connected ? (
                  <Button variant="outline" size="sm" disabled={disconnect.isPending} onClick={() => disconnect.mutate({ provider: row.provider })}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a href={connectIntegrationUrl(row.provider)}>Connect</a>
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
