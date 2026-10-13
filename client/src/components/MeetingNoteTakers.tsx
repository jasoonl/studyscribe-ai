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

export type NoteTakerPrefill = { meetingUrl?: string | null; title?: string; calendarEventId?: string; start?: string | null };

/** Mirrors the server's naming (server/recall.ts) so the dialog shows what people in the call will see. */
function previewName(name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9À-ɏ' -]/g, "").slice(0, 30);
  return first ? `StudyScribe note-taker (recording for ${first})` : "StudyScribe note-taker (recording)";
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** "Send a note-taker" (A4): the meeting link, a reminder to tell people, and what the bot will be called. */
export function SendNoteTakerDialog({ prefill, onClose }: { prefill: NoteTakerPrefill | null; onClose: () => void }) {
  const { user } = useAuth();
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
      toast.success(bot.joinAt ? `The note-taker will join at ${when(String(bot.joinAt))}.` : "The note-taker is on its way. Let it in if the meeting has a waiting room.");
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
          <DialogTitle>Send a note-taker</DialogTitle>
          <DialogDescription>
            A note-taker joins your Zoom, Google Meet or Teams call, records the audio and leaves when the call ends. The recording then appears in your library and is transcribed like any other.
          </DialogDescription>
        </DialogHeader>

        {status.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !configured ? (
          <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            The meeting note-taker is not set up on this server yet. Until it is, open the meeting in this browser and record it with "Record a tab or screen audio" on the Record page.
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
              <Label htmlFor="note-taker-url">Meeting link</Label>
              <Input id="note-taker-url" type="url" inputMode="url" value={meetingUrl} onChange={event => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/abc-defg-hij" autoFocus={!prefill?.meetingUrl} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-taker-title">Name for the recording</Label>
              <Input id="note-taker-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={255} placeholder="Project sync" />
            </div>
            <div className="rounded-xl border border-border px-4 py-3 text-sm">
              <p className="text-muted-foreground">People in the call will see it as</p>
              <p className="mt-0.5 font-medium">{previewName(user?.name)}</p>
              <p className="mt-2 text-muted-foreground">It also posts a message in the meeting chat saying it is recording for you.{scheduled && prefill?.start ? ` It joins a minute before ${when(prefill.start)}.` : ""}</p>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="note-taker-consent" checked={consent} onCheckedChange={value => setConsent(value === true)} className="mt-0.5" />
              <Label htmlFor="note-taker-consent" className="text-sm font-normal leading-snug">
                I will tell everyone in the meeting that it is being recorded, and I have their consent where the law or my school or workplace requires it.
              </Label>
            </div>
          </form>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{configured ? "Cancel" : "Close"}</Button>
          {configured && (
            <Button type="submit" form="note-taker-form" disabled={!consent || !meetingUrl.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : scheduled ? "Schedule note-taker" : "Send note-taker"}
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
  const { data } = trpc.meetingBots.list.useQuery(undefined, {
    // While a note-taker is on its way, each poll also moves it along (see server/meetingBots.ts).
    refetchInterval: query => (query.state.data?.bots.some(bot => bot.active) ? 10_000 : false),
    refetchOnWindowFocus: true,
  });
  const stop = trpc.meetingBots.stop.useMutation({
    onSuccess: async result => {
      toast.success(result.status === "cancelled" ? "Note-taker cancelled" : "The note-taker is leaving. What it recorded so far will still be saved.");
      await utils.meetingBots.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const dismiss = trpc.meetingBots.dismiss.useMutation({ onSuccess: () => utils.meetingBots.list.invalidate() });

  const bots = (data?.bots ?? []).slice(0, 4);

  return (
    <section aria-labelledby="note-takers-heading">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="note-takers-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Online meetings</h2>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Send a note-taker to a Zoom, Google Meet or Teams call. It records, and the transcript lands here.</p>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5 self-start sm:self-auto" onClick={onSend}>
            <Bot className="h-3.5 w-3.5" />
            Send a note-taker
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
                    {bot.platformLabel} · {bot.status === "scheduled" && bot.joinAt ? `Joins at ${when(String(bot.joinAt))}` : bot.status === "imported" ? "Saved to your library" : bot.status === "cancelled" ? "Cancelled" : bot.statusDetail ?? "On its way"}
                  </span>
                </span>
                {bot.active && !["ended", "done", "importing"].includes(bot.status) ? (
                  <Button size="sm" variant="ghost" className="shrink-0" disabled={stop.isPending} onClick={() => stop.mutate({ id: bot.id })}>
                    {["scheduled", "joining", "waiting_room"].includes(bot.status) ? "Cancel" : "Stop recording"}
                  </Button>
                ) : bot.active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Working" />
                ) : (
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Clear ${bot.title} from this list`} onClick={() => dismiss.mutate({ id: bot.id })}>
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
