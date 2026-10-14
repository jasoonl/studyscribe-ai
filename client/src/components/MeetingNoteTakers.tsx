import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bot, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { offerUpgradeOnUsageLimit } from "@/lib/usageLimit";
import { cn } from "@/lib/utils";
import { htmlLangFor } from "@shared/i18n";
import { getUiLanguage, useI18n } from "@/i18n";

export type NoteTakerPrefill = { meetingUrl?: string | null; title?: string; calendarEventId?: string; start?: string | null };

/** Mirrors the server's naming (server/recall.ts) so the dialog shows what people in the call will see. */
function previewName(name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9À-ɏ' -]/g, "").slice(0, 30);
  return first ? `StudyScribe note-taker (recording for ${first})` : "StudyScribe note-taker (recording)";
}

const when = (iso: string) => new Date(iso).toLocaleString(htmlLangFor(getUiLanguage()), { weekday: "short", hour: "numeric", minute: "2-digit" });

/** "Send a note-taker" (A4): the meeting link, a reminder to tell people, and what the bot will be called. */
export function SendNoteTakerDialog({ prefill, onClose }: { prefill: NoteTakerPrefill | null; onClose: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const status = trpc.meetingBots.status.useQuery(undefined, { enabled: prefill !== null, staleTime: 5 * 60_000 });
  const [meetingUrl, setMeetingUrl] = useState("");
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    if (!prefill) return;
    setMeetingUrl(prefill.meetingUrl ?? "");
    setTitle(prefill.title ?? "");
    setConsent(false);
  }, [prefill]);

  const send = trpc.meetingBots.send.useMutation({
    onSuccess: async bot => {
      toast.success(bot.joinAt ? t("bots.willJoin", { time: when(String(bot.joinAt)) }) : t("bots.onItsWay"));
      await utils.meetingBots.list.invalidate();
      onClose();
    },
    onError: error => {
      toast.error(error.message);
      offerUpgradeOnUsageLimit(error);
    },
  });

  const configured = status.data?.configured;
  const scheduled = prefill?.start && Date.parse(prefill.start) - Date.now() > 3 * 60_000;

  return (
    <Dialog open={prefill !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bots.send")}</DialogTitle>
          <DialogDescription>
            {t("bots.dialogText")}
          </DialogDescription>
        </DialogHeader>

        {status.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !configured ? (
          <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            {t("bots.notSetUp")}
          </div>
        ) : (
          <form
            id="note-taker-form"
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (!consent) return;
              send.mutate({ meetingUrl: meetingUrl.trim(), title: title.trim() || undefined, calendarEventId: prefill?.calendarEventId, consent: true });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="note-taker-url">{t("bots.link")}</Label>
              <Input id="note-taker-url" type="url" inputMode="url" value={meetingUrl} onChange={event => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/abc-defg-hij" autoFocus={!prefill?.meetingUrl} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-taker-title">{t("bots.name")}</Label>
              <Input id="note-taker-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={255} placeholder={t("bots.namePlaceholder")} />
            </div>
            <div className="rounded-xl border border-border px-4 py-3 text-sm">
              <p className="text-muted-foreground">{t("bots.seenAs")}</p>
              <p className="mt-0.5 font-medium">{previewName(user?.name)}</p>
              <p className="mt-2 text-muted-foreground">{t("bots.chatNote")}{scheduled && prefill?.start ? ` ${t("bots.joinsBefore", { time: when(prefill.start) })}` : ""}</p>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="note-taker-consent" checked={consent} onCheckedChange={value => setConsent(value === true)} className="mt-0.5" />
              <Label htmlFor="note-taker-consent" className="text-sm font-normal leading-snug">
                {t("bots.consent")}
              </Label>
            </div>
          </form>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{configured ? t("bots.cancel") : t("bots.close")}</Button>
          {configured && (
            <Button type="submit" form="note-taker-form" disabled={!consent || !meetingUrl.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : scheduled ? t("bots.schedule") : t("bots.sendNow")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TONE: Record<string, string> = {
  recording: "text-primary",
  failed: "text-destructive",
};

/** The dashboard row for meeting note-takers: a button to send one, and the ones on their way or just finished. */
export function MeetingNoteTakers({ onSend }: { onSend: () => void }) {
  const utils = trpc.useUtils();
  const { t } = useI18n();
  const { data } = trpc.meetingBots.list.useQuery(undefined, {
    // While a note-taker is on its way, each poll also moves it along (see server/meetingBots.ts).
    refetchInterval: query => (query.state.data?.bots.some(bot => bot.active) ? 10_000 : false),
    refetchOnWindowFocus: true,
  });
  const stop = trpc.meetingBots.stop.useMutation({
    onSuccess: async result => {
      toast.success(result.status === "cancelled" ? t("bots.cancelled") : t("bots.leaving"));
      await utils.meetingBots.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const dismiss = trpc.meetingBots.dismiss.useMutation({ onSuccess: () => utils.meetingBots.list.invalidate() });

  const bots = (data?.bots ?? []).slice(0, 4);

  return (
    <section aria-labelledby="note-takers-heading">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="note-takers-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("bots.heading")}</h2>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{t("bots.intro")}</p>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5 self-start sm:self-auto" onClick={onSend}>
            <Bot className="h-3.5 w-3.5" />
            {t("bots.send")}
          </Button>
        </div>
        {bots.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {bots.map(bot => (
              <li key={bot.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {bot.recordingId ? <Link href={`/recording/${bot.recordingId}`} className="hover:underline">{bot.title}</Link> : bot.title}
                  </span>
                  <span className={cn("block truncate text-xs", STATUS_TONE[bot.status] ?? "text-muted-foreground")}>
                    {bot.platformLabel} · {bot.status === "scheduled" && bot.joinAt ? t("bots.joinsAt", { time: when(String(bot.joinAt)) }) : bot.status === "imported" ? t("bots.saved") : bot.status === "cancelled" ? t("bots.statusCancelled") : bot.statusDetail ?? t("bots.statusOnItsWay")}
                  </span>
                </span>
                {bot.active && !["ended", "done", "importing"].includes(bot.status) ? (
                  <Button size="sm" variant="ghost" className="shrink-0" disabled={stop.isPending} onClick={() => stop.mutate({ id: bot.id })}>
                    {["scheduled", "joining", "waiting_room"].includes(bot.status) ? t("bots.cancel") : t("bots.stop")}
                  </Button>
                ) : bot.active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("bots.working")} />
                ) : (
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t("bots.clear", { title: bot.title })} onClick={() => dismiss.mutate({ id: bot.id })}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
