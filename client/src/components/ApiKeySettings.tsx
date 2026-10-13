import { useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trpc } from "@/lib/trpc";

const ago = (value: string | Date) => formatDistanceToNow(new Date(value), { addSuffix: true });

function NewKeyDialog({ created, onClose }: { created: { key: string; name: string; scope: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={created !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy your new key</DialogTitle>
          <DialogDescription>
            This is the only time it is shown. Keep it somewhere safe, such as a password manager or your server's environment, and never put it in a web page or app that other people download.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <code className="flex-1 break-all text-xs">{created?.key}</code>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label="Copy key"
            onClick={() => {
              if (!created) return;
              void navigator.clipboard.writeText(created.key);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I have copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Personal API keys (E5) in Settings: create, list, revoke. */
export function ApiKeySettings() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.apiKeys.list.useQuery();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [created, setCreated] = useState<{ key: string; name: string; scope: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: number; name: string } | null>(null);

  const refresh = () => utils.apiKeys.list.invalidate();
  const create = trpc.apiKeys.create.useMutation({
    onSuccess: async result => {
      setCreated(result);
      setName("");
      setScope("read");
      setAdding(false);
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const revoke = trpc.apiKeys.revoke.useMutation({
    onSuccess: async () => {
      toast.success("Key revoked. Requests with it now fail.");
      setRevoking(null);
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const active = (data?.keys ?? []).filter(key => !key.revokedAt);
  const revoked = (data?.keys ?? []).filter(key => key.revokedAt);

  return (
    <Card className="gap-0 p-6" id="api-keys">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">API keys</h2>
        <Link href="/developers" className="text-sm font-medium text-primary underline-offset-4 hover:underline">API docs</Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Let your own scripts read your recordings, transcripts, notes and flashcards. A read and write key can also import recordings from links and write notes, which count toward your plan like anything you do here. Keys can never change billing, manage keys or delete your account.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : data && !data.available ? (
        <p className="mt-4 text-sm text-muted-foreground">API keys are not available on this server yet.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {active.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {active.map(key => (
                <li key={key.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{key.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <code>{key.prefix}…</code> · {key.scope === "write" ? "Read and write" : "Read only"} · {key.lastUsedAt ? `used ${ago(key.lastUsedAt)}` : "never used"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setRevoking({ id: key.id, name: key.name })}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <form
              className="space-y-4 rounded-xl border border-border p-4"
              onSubmit={event => {
                event.preventDefault();
                create.mutate({ name: name.trim(), scope });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="api-key-name">Name</Label>
                <Input id="api-key-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Obsidian sync script" autoFocus />
              </div>
              <fieldset className="min-w-0 space-y-2">
                <legend className="mb-1 text-sm font-medium">Access</legend>
                <RadioGroup value={scope} onValueChange={value => setScope(value as "read" | "write")} className="gap-2">
                  <div className="flex items-start gap-2.5">
                    <RadioGroupItem id="api-scope-read" value="read" className="mt-0.5" />
                    <Label htmlFor="api-scope-read" className="flex flex-col items-start gap-0.5 font-normal">
                      <span className="text-sm">Read only</span>
                      <span className="text-xs text-muted-foreground">List recordings and read transcripts, notes and flashcards.</span>
                    </Label>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <RadioGroupItem id="api-scope-write" value="write" className="mt-0.5" />
                    <Label htmlFor="api-scope-write" className="flex flex-col items-start gap-0.5 font-normal">
                      <span className="text-sm">Read and write</span>
                      <span className="text-xs text-muted-foreground">Also import recordings from links and write notes.</span>
                    </Label>
                  </div>
                </RadioGroup>
              </fieldset>
              <div className="flex gap-2">
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create key"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)}>Create a key</Button>
          )}

          {revoked.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Revoked: {revoked.map(key => `${key.name} (${key.prefix}…)`).join(", ")}
            </p>
          )}
        </div>
      )}

      <NewKeyDialog created={created} onClose={() => setCreated(null)} />

      <Dialog open={revoking !== null} onOpenChange={open => !open && setRevoking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke "{revoking?.name}"?</DialogTitle>
            <DialogDescription>Anything using this key stops working straight away. This cannot be undone; you can create a new key instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>Keep it</Button>
            <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoking && revoke.mutate({ id: revoking.id })}>
              {revoke.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
