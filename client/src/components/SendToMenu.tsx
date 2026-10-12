import { useState } from "react";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

type Kind = "note" | "guide";
type Provider = "notion" | "google_drive";

export function connectIntegrationUrl(provider: Provider) {
  const path = provider === "notion" ? "notion" : "google";
  return `/api/integrations/${path}/connect?origin=${encodeURIComponent(window.location.origin)}`;
}

function openResult(url: string | undefined, where: string) {
  toast.success(`Sent to ${where}`, url ? { action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener,noreferrer") } } : undefined);
}

/**
 * "Send to Notion / Google Docs" for one note or study guide (E3). Explains
 * itself when an integration is not set up on the server or not connected yet.
 */
export function SendToMenu({ kind, id, size = "sm" }: { kind: Kind; id: number; size?: "sm" | "default" }) {
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
      toast.error(error instanceof Error ? error.message : "Could not send it");
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
            Send to
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Make a copy in</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => choose("notion")}>Notion</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("google_drive")}>Google Docs</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={explain !== null} onOpenChange={open => !open && setExplain(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{explainInfo?.configured && status?.available ? `Connect ${explainName}` : `${explainName} is not set up`}</DialogTitle>
            <DialogDescription>
              {!status?.available
                ? "Connected apps are not available on this server yet."
                : !explainInfo?.configured
                  ? `Sending to ${explainName} needs the site owner to add ${explain === "notion" ? "a Notion integration" : "Google Drive access"} first. Until then you can copy the text or export it from the page.`
                  : explain === "notion"
                    ? "Connect your Notion workspace once. Notion asks which pages StudyScribe may add to; new notes go under one of them."
                    : "Connect Google once. StudyScribe can then create documents in your Drive, and can only see the documents it created."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExplain(null)}>
              Close
            </Button>
            {status?.available && explainInfo?.configured && (
              <Button asChild>
                <a href={connectIntegrationUrl(explain!)}>Connect {explainName}</a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notionOpen} onOpenChange={setNotionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to Notion</DialogTitle>
            <DialogDescription>Pick the page to put it under. Only pages you shared with StudyScribe when connecting are listed.</DialogDescription>
          </DialogHeader>
          {pages.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pages.error ? (
            <p className="text-sm text-destructive">{pages.error.message}</p>
          ) : pages.data && pages.data.pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              StudyScribe cannot see any pages yet. Reconnect Notion in Settings and tick at least one page.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`notion-parent-${kind}-${id}`}>Page</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id={`notion-parent-${kind}-${id}`} className="w-full">
                  <SelectValue placeholder="Choose a page" />
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
              Cancel
            </Button>
            <Button disabled={!parentId || send.isPending} onClick={() => sendNow("notion", parentId)} className="gap-2">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
