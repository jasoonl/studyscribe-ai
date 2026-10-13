import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * D4: for a recording made from a calendar event or by the meeting
 * note-taker, the owner can email a set of notes to the people invited.
 * Nothing is pre-selected and nothing is sent without pressing Send; the
 * preview is the exact email, including the "don't email me" link.
 */
export function AttendeeShare({ recordingId, transcriptReady }: { recordingId: number; transcriptReady: boolean }) {
  const { data } = trpc.attendeeShare.get.useQuery({ recordingId }, { enabled: recordingId > 0, retry: false, refetchOnWindowFocus: false });
  const [open, setOpen] = useState(false);
  if (!data?.event || data.attendees.length === 0) return null;
  const count = data.attendees.length;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        From {data.event.source === "meeting_bot" ? "a meeting your note-taker recorded" : "your calendar"}: <span className="font-medium text-foreground">{data.event.title}</span>, {count} {count === 1 ? "person" : "people"} invited.
      </p>
      <Button size="sm" variant="outline" className="shrink-0 gap-1.5 self-start sm:self-auto" disabled={!transcriptReady} onClick={() => setOpen(true)} title={transcriptReady ? undefined : "Available once the transcript is ready"}>
        <Mail className="h-3.5 w-3.5" />
        Email notes to attendees
      </Button>
      <AttendeeShareDialog recordingId={recordingId} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AttendeeShareDialog({ recordingId, open, onOpenChange }: { recordingId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.attendeeShare.get.useQuery({ recordingId }, { enabled: open });
  const [noteId, setNoteId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [debouncedMessage, setDebouncedMessage] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMessage(message), 400);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (open && data?.notes.length && noteId === null) setNoteId(data.notes[0].id);
  }, [open, data?.notes, noteId]);
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setMessage("");
    }
  }, [open]);

  const preview = trpc.attendeeShare.preview.useQuery(
    { recordingId, noteId: noteId ?? 0, message: debouncedMessage || undefined },
    { enabled: open && noteId !== null, placeholderData: previous => previous },
  );
  const send = trpc.attendeeShare.send.useMutation({
    onSuccess: async result => {
      const parts = [`Sent to ${result.sent.length} ${result.sent.length === 1 ? "person" : "people"}.`];
      if (result.skipped.length) parts.push(`${result.skipped.length} asked not to get StudyScribe emails, so they were skipped.`);
      if (result.failed.length) parts.push(`${result.failed.length} could not be sent; try them again.`);
      (result.failed.length ? toast.warning : toast.success)(parts.join(" "));
      await utils.attendeeShare.get.invalidate({ recordingId });
      if (!result.failed.length) onOpenChange(false);
    },
    onError: error => toast.error(error.message),
  });

  const selectable = useMemo(() => (data?.attendees ?? []).filter(attendee => !attendee.optedOut), [data?.attendees]);
  const allSelected = selectable.length > 0 && selectable.every(attendee => selected.has(attendee.email));

  const toggle = (email: string, on: boolean) =>
    setSelected(current => {
      const next = new Set(current);
      if (on) next.add(email);
      else next.delete(email);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] grid-cols-1 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Email notes to attendees</DialogTitle>
          <DialogDescription>
            Each person gets their own email from you, with a link to stop emails from StudyScribe. Replies come to you. Only people invited to {data?.event?.title ?? "the event"} can be chosen.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data.configured ? (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Emailing notes is not set up on this server yet. You can still share the recording itself with Share.</p>
        ) : data.notes.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Write notes for this recording first (Notes tab), then come back to send them.</p>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="attendee-note">Notes to send</Label>
                <Select value={noteId ? String(noteId) : undefined} onValueChange={value => setNoteId(Number(value))}>
                  <SelectTrigger id="attendee-note" className="w-full"><SelectValue placeholder="Choose notes" /></SelectTrigger>
                  <SelectContent>
                    {data.notes.map(note => (
                      <SelectItem key={note.id} value={String(note.id)}>
                        {note.label}, {format(new Date(note.createdAt), "MMM d, h:mm a")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attendee-message">Message (optional)</Label>
                <Textarea id="attendee-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={1000} rows={3} placeholder="Thanks for the call. Here are the notes." />
              </div>
              <fieldset className="min-w-0 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <legend className="text-sm font-medium">Send to</legend>
                  {selectable.length > 1 && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map(attendee => attendee.email)))}>
                      {allSelected ? "Clear" : "Select everyone"}
                    </Button>
                  )}
                </div>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                  {data.attendees.map(attendee => {
                    const id = `attendee-${attendee.email}`;
                    return (
                      <li key={attendee.email} className="flex items-start gap-3 px-3 py-2.5">
                        <Checkbox id={id} className="mt-0.5" disabled={attendee.optedOut} checked={selected.has(attendee.email)} onCheckedChange={value => toggle(attendee.email, value === true)} />
                        <Label htmlFor={id} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 font-normal">
                          <span className="w-full truncate text-sm">{attendee.name ?? attendee.email}</span>
                          <span className="w-full truncate text-xs text-muted-foreground">
                            {attendee.name ? `${attendee.email} · ` : ""}
                            {attendee.optedOut ? "Asked not to get StudyScribe emails" : attendee.sentAt ? `Sent ${format(new Date(attendee.sentAt), "MMM d")}` : "Not sent yet"}
                          </span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">Preview</p>
              {preview.data ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <dl className="space-y-0.5 border-b border-border bg-muted/40 px-3 py-2 text-xs">
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">From</dt><dd className="min-w-0 truncate">{preview.data.from}</dd></div>
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">Reply to</dt><dd className="min-w-0 truncate">{preview.data.replyTo}</dd></div>
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">Subject</dt><dd className="min-w-0 truncate">{preview.data.subject}</dd></div>
                  </dl>
                  {/* sandbox="" : the preview can't run scripts or navigate. */}
                  <iframe title="Email preview" sandbox="" srcDoc={preview.data.html} className="h-80 w-full bg-white md:h-[26rem]" />
                </div>
              ) : (
                <div className="flex h-80 items-center justify-center rounded-xl border border-border"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {data?.configured && data.notes.length > 0 && (
            <Button
              type="button"
              disabled={selected.size === 0 || noteId === null || send.isPending}
              onClick={() => noteId !== null && send.mutate({ recordingId, noteId, recipients: Array.from(selected), message: message.trim() || undefined })}
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : selected.size === 0 ? "Choose people to send to" : `Send to ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
