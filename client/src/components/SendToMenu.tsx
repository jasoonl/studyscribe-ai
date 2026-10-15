import { useState } from "react";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { t, useI18n } from "@/i18n";

type Kind = "note" | "guide";
type Provider = "notion" | "google_drive";

export function connectIntegrationUrl(provider: Provider | "google_calendar") {
  const path = provider === "notion" ? "notion" : provider === "google_calendar" ? "google-calendar" : "google";
  return `/api/integrations/${path}/connect?origin=${encodeURIComponent(window.location.origin)}`;
}

function openResult(url: string | undefined, where: string) {
  toast.success(t("sendTo.sent", { app: where }), url ? { action: { label: t("common.open"), onClick: () => window.open(url, "_blank", "noopener,noreferrer") } } : undefined);
}

/**
 * "Send to Notion / Google Docs" for one note or study guide (E3). Explains
 * itself when an integration is not set up on the server or not connected yet.
 */
export function SendToMenu({ kind, id, size = "sm" }: { kind: Kind; id: number; size?: "sm" | "default" }) {
  useI18n();
  const { data: status } = trpc.integrations.status.useQuery(undefined, { staleTime: 60_000 });
  const send = trpc.integrations.send.useMutation();
  const [notionOpen, setNotionOpen] = useState(false);
  const [explain, setExplain] = useState<Provider | null>(null);
  const [parentId, setParentId] = useState<string>("");
  const pages = trpc.integrations.notionPages.useQuery(undefined, { enabled: notionOpen, retry: false });

  const sendNow = async (provider: Provider, notionParentId?: string) => {
    try {
      const result = await send.mutateAsync({ provider, kind, id, notionParentId });
      openResult(result.url, provider === "notion" ? "Notion" : "Google Docs");
      setNotionOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sendTo.failed"));
    }
  };

  const choose = (provider: Provider) => {
    const info = provider === "notion" ? status?.notion : status?.google;
    if (!status?.available || !info?.configured || !info.connected) {
      setExplain(provider);
      return;
    }
    if (provider === "notion") setNotionOpen(true);
    else void sendNow("google_drive");
  };

  const explainInfo = explain === "notion" ? status?.notion : status?.google;
  const explainName = explain === "notion" ? "Notion" : "Google Docs";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={size} className="gap-2" disabled={send.isPending}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("attendees.sendTo")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("sendTo.makeCopyIn")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => choose("notion")}>Notion</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("google_drive")}>Google Docs</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={explain !== null} onOpenChange={open => !open && setExplain(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{explainInfo?.configured && status?.available ? t("sendTo.connect", { app: explainName }) : t("sendTo.notSetUp", { app: explainName })}</DialogTitle>
            <DialogDescription>
              {!status?.available
                ? t("sendTo.unavailable")
                : !explainInfo?.configured
                  ? t(explain === "notion" ? "sendTo.ownerNotion" : "sendTo.ownerGoogle")
                  : explain === "notion"
                    ? t("sendTo.notionExplain")
                    : t("sendTo.googleExplain")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExplain(null)}>
              {t("bots.close")}
            </Button>
            {status?.available && explainInfo?.configured && (
              <Button asChild>
                <a href={connectIntegrationUrl(explain!)}>{t("sendTo.connect", { app: explainName })}</a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notionOpen} onOpenChange={setNotionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sendTo.notionTitle")}</DialogTitle>
            <DialogDescription>{t("sendTo.notionText")}</DialogDescription>
          </DialogHeader>
          {pages.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pages.error ? (
            <p className="text-sm text-destructive">{pages.error.message}</p>
          ) : pages.data && pages.data.pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("sendTo.noPages")}
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`notion-parent-${kind}-${id}`}>{t("sendTo.page")}</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id={`notion-parent-${kind}-${id}`} className="w-full">
                  <SelectValue placeholder={t("sendTo.choosePage")} />
                </SelectTrigger>
                <SelectContent>
                  {pages.data?.pages.map(page => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotionOpen(false)}>
              {t("bots.cancel")}
            </Button>
            <Button disabled={!parentId || send.isPending} onClick={() => sendNow("notion", parentId)} className="gap-2">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              {t("sendTo.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
