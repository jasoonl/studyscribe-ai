import { useState } from "react";
import { Check, Copy, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useI18n, t, tn } from "@/i18n";
import type { MessageKey } from "@shared/i18n";
import { relativeTime } from "@/lib/relativeTime";
import { MAX_WEBHOOKS_PER_USER, WEBHOOK_EVENTS, type WebhookEvent } from "@shared/webhooks";

const EVENT_LABELS: Record<WebhookEvent, MessageKey> = {
  "recording.completed": "settingsCards.hooks.event.recordingCompleted",
  "transcript.ready": "settingsCards.hooks.event.transcriptReady",
  "notes.generated": "settingsCards.hooks.event.notesGenerated",
};
import { WEBHOOK_FORMAT_LABELS, webhookFormatFor, type WebhookFormat } from "@shared/webhookFormats";

/** Slack and Discord webhook URLs are secrets in themselves; show only the host once saved. */
function displayUrl(url: string, format: WebhookFormat) {
  if (format === "json") return url;
  try {
    return `${new URL(url).host}/…`;
  } catch {
    return url;
  }
}

type Delivery = {
  id: number;
  event: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: string | Date | null;
  lastAttemptAt: string | Date | null;
  createdAt: string | Date;
};

const ago = (value: string | Date) => relativeTime(value);

function deliveryStatus(delivery: Delivery) {
  if (delivery.status === "succeeded") return delivery.responseStatus ? t("settingsCards.hooks.deliveredStatus", { status: delivery.responseStatus }) : t("settingsCards.hooks.delivered");
  if (delivery.status === "failed") return tn("settingsCards.hooks.gaveUp", delivery.attempts);
  if (delivery.attempts === 0) return t("settingsCards.hooks.sending");
  return delivery.nextAttemptAt ? t("settingsCards.hooks.retrying", { when: relativeTime(delivery.nextAttemptAt) }) : t("settingsCards.hooks.retryingSoon");
}

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useI18n();
  return (
    <Dialog open={secret !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settingsCards.hooks.secretTitle")}</DialogTitle>
          <DialogDescription>{t("settingsCards.hooks.secretText")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <code className="flex-1 break-all text-xs">{secret}</code>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label={t("settingsCards.hooks.copySecret")}
            onClick={() => {
              if (!secret) return;
              navigator.clipboard.writeText(secret);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("settingsCards.hooks.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventPicker({ value, onChange, idPrefix }: { value: WebhookEvent[]; onChange: (events: WebhookEvent[]) => void; idPrefix: string }) {
  useI18n();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{t("settingsCards.hooks.sendWhen")}</legend>
      {WEBHOOK_EVENTS.map(event => (
        <div key={event} className="flex items-start gap-2.5">
          <Checkbox
            id={`${idPrefix}-${event}`}
            checked={value.includes(event)}
            onCheckedChange={checked => onChange(checked ? [...value, event] : value.filter(item => item !== event))}
            className="mt-0.5"
          />
          <Label htmlFor={`${idPrefix}-${event}`} className="flex flex-col items-start gap-0.5 font-normal">
            <span className="text-sm">{t(EVENT_LABELS[event])}</span>
            <code className="text-xs text-muted-foreground">{event}</code>
          </Label>
        </div>
      ))}
    </fieldset>
  );
}

/** Outgoing webhooks (E4) in Settings. */
export function WebhookSettings() {
  useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.webhooks.list.useQuery();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["transcript.ready"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => utils.webhooks.list.invalidate();
  const onError = (error: { message: string }) => toast.error(error.message);
  const create = trpc.webhooks.create.useMutation({
    onSuccess: async result => {
      setSecret(result.secret);
      setUrl("");
      setDescription("");
      setAdding(false);
      await refresh();
    },
    onError,
  });
  const update = trpc.webhooks.update.useMutation({ onSuccess: refresh, onError });
  const rotate = trpc.webhooks.rotateSecret.useMutation({ onSuccess: result => setSecret(result.secret), onError });
  const remove = trpc.webhooks.remove.useMutation({ onSuccess: refresh, onError });
  const sendTest = trpc.webhooks.sendTest.useMutation({
    onSuccess: async result => {
      if (result.ok) toast.success(t("settingsCards.hooks.testDelivered", { status: result.status ?? "" }));
      else toast.error(t("settingsCards.hooks.testFailed", { error: result.error ?? "" }));
      await refresh();
    },
    onError,
  });
  const redeliver = trpc.webhooks.redeliver.useMutation({
    onSuccess: async result => {
      if (result.ok) toast.success(t("settingsCards.hooks.redelivered"));
      else toast.error(t("settingsCards.hooks.stillFailing", { error: result.error ?? "" }));
      await refresh();
    },
    onError,
  });

  const endpoints = data?.endpoints ?? [];

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{t("settingsCards.hooks.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("settingsCards.hooks.intro")}
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && !data.available ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("settingsCards.hooks.notAvailable")}</p>
      ) : (
        <div className="mt-5 space-y-4">
          {endpoints.map(endpoint => (
            <div key={endpoint.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm">{displayUrl(endpoint.url, endpoint.format)}</span>
                    {endpoint.format !== "json" && (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("settingsCards.hooks.formatMessage", { format: WEBHOOK_FORMAT_LABELS[endpoint.format] })}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {endpoint.description ? `${endpoint.description} · ` : ""}
                    {endpoint.events.join(", ")}
                  </p>
                </div>
                <Switch
                  checked={endpoint.enabled}
                  onCheckedChange={enabled => update.mutate({ id: endpoint.id, enabled })}
                  aria-label={endpoint.enabled ? t("settingsCards.hooks.pause") : t("settingsCards.hooks.turnOn")}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t("settingsCards.hooks.options")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => sendTest.mutate({ id: endpoint.id })}>{t("settingsCards.hooks.sendATest")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => rotate.mutate({ id: endpoint.id })}>{t("settingsCards.hooks.newSecret")}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => remove.mutate({ id: endpoint.id })}>
                      {t("settingsCards.hooks.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={sendTest.isPending} onClick={() => sendTest.mutate({ id: endpoint.id })}>
                  {sendTest.isPending && sendTest.variables?.id === endpoint.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settingsCards.hooks.sendTest")}
                </Button>
              </div>
              <Collapsible className="mt-3">
                <CollapsibleTrigger asChild>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                    {t("settingsCards.hooks.recent", { count: endpoint.deliveries.length })}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {endpoint.deliveries.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">{t("settingsCards.hooks.nothingSent")}</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                      {(endpoint.deliveries as Delivery[]).map(delivery => (
                        <li key={delivery.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                          <code className="font-medium">{delivery.event}</code>
                          <span className={delivery.status === "succeeded" ? "text-foreground" : "text-destructive"}>{deliveryStatus(delivery)}</span>
                          <span className="text-muted-foreground">{ago(delivery.createdAt)}</span>
                          {delivery.error && delivery.status !== "succeeded" && <span className="w-full text-muted-foreground">{delivery.error}</span>}
                          {delivery.status !== "succeeded" && (
                            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" disabled={redeliver.isPending} onClick={() => redeliver.mutate({ deliveryId: delivery.id })}>
                              {t("settingsCards.hooks.redeliver")}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
          ))}

          {adding ? (
            <form
              className="space-y-4 rounded-xl border border-border p-4"
              onSubmit={event => {
                event.preventDefault();
                create.mutate({ url: url.trim(), description: description.trim() || undefined, events });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="webhook-url">{t("settingsCards.hooks.endpointUrl")}</Label>
                <Input id="webhook-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://hooks.example.com/studyscribe" autoFocus />
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {webhookFormatFor(url.trim()) === "json"
                    ? t("settingsCards.hooks.urlHelp")
                    : t("settingsCards.hooks.urlHelpChat", { format: WEBHOOK_FORMAT_LABELS[webhookFormatFor(url.trim())] })}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="webhook-description">{t("settingsCards.hooks.nameOptional")}</Label>
                <Input id="webhook-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={120} placeholder={t("settingsCards.hooks.namePlaceholder")} />
              </div>
              <EventPicker value={events} onChange={setEvents} idPrefix="new-webhook" />
              <div className="flex gap-2">
                <Button type="submit" disabled={!url.trim() || events.length === 0 || create.isPending}>
                  {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settingsCards.hooks.add")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                  {t("settingsCards.hooks.cancel")}
                </Button>
              </div>
            </form>
          ) : endpoints.length < MAX_WEBHOOKS_PER_USER ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              {t("settingsCards.hooks.addA")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("settingsCards.hooks.max", { max: MAX_WEBHOOKS_PER_USER })}</p>
          )}
        </div>
      )}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </Card>
  );
}
