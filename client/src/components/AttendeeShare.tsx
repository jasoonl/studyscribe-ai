import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Trans, getUiLanguage, useI18n } from "@/i18n";
import { htmlLangFor, pluralSuffix, type MessageKey } from "@shared/i18n";

const noteDate = (value: string | Date) =>
  new Date(value).toLocaleString(htmlLangFor(getUiLanguage()), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * D4: for a recording made from a calendar event or by the meeting
 * note-taker, the owner can email a set of notes to the people invited.
 * Nothing is pre-selected and nothing is sent without pressing Send; the
 * preview is the exact email, including the "don't email me" link.
 */
export function AttendeeShare({ recordingId, transcriptReady }: { recordingId: number; transcriptReady: boolean }) {
  const { t, language } = useI18n();
  const { data } = trpc.attendeeShare.get.useQuery({ recordingId }, { enabled: recordingId > 0, retry: false, refetchOnWindowFocus: false });
  const [open, setOpen] = useState(false);
  if (!data?.event || data.attendees.length === 0) return null;
  const count = data.attendees.length;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        <Trans
          k={`${data.event.source === "meeting_bot" ? "attendees.fromBot" : "attendees.fromCalendar"}_${pluralSuffix(language, count)}` as MessageKey}
          vars={{ title: data.event.title, count }}
          parts={{ b: text => <span className="font-medium text-foreground">{text}</span> }}
        />
      </p>
      <Button size="sm" variant="outline" className="shrink-0 gap-1.5 self-start sm:self-auto" disabled={!transcriptReady} onClick={() => setOpen(true)} title={transcriptReady ? undefined : t("attendees.waitTranscript")}>
        <Mail className="h-3.5 w-3.5" />
        {t("attendees.button")}
      </Button>
      <AttendeeShareDialog recordingId={recordingId} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AttendeeShareDialog({ recordingId, open, onOpenChange }: { recordingId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, tn, formatDate } = useI18n();
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
      const parts = [tn("attendees.sent", result.sent.length)];
      if (result.skipped.length) parts.push(tn("attendees.skipped", result.skipped.length));
      if (result.failed.length) parts.push(tn("attendees.failed", result.failed.length));
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
          <DialogTitle>{t("attendees.button")}</DialogTitle>
          <DialogDescription>
            {data?.event?.title ? t("attendees.dialogText", { event: data.event.title }) : t("attendees.dialogTextGeneric")}
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data.configured ? (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{t("attendees.notSetUp")}</p>
        ) : data.notes.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{t("attendees.noNotes")}</p>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="attendee-note">{t("attendees.notesToSend")}</Label>
                <Select value={noteId ? String(noteId) : undefined} onValueChange={value => setNoteId(Number(value))}>
                  <SelectTrigger id="attendee-note" className="w-full"><SelectValue placeholder={t("attendees.chooseNotes")} /></SelectTrigger>
                  <SelectContent>
                    {data.notes.map(note => (
                      <SelectItem key={note.id} value={String(note.id)}>
                        {note.label}, {noteDate(note.createdAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attendee-message">{t("attendees.message")}</Label>
                <Textarea id="attendee-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={1000} rows={3} placeholder={t("attendees.messagePlaceholder")} />
              </div>
              <fieldset className="min-w-0 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <legend className="text-sm font-medium">{t("attendees.sendTo")}</legend>
                  {selectable.length > 1 && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map(attendee => attendee.email)))}>
                      {allSelected ? t("attendees.clear") : t("attendees.selectAll")}
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
                            {attendee.optedOut ? t("attendees.optedOut") : attendee.sentAt ? t("attendees.sentOn", { date: formatDate(attendee.sentAt, { month: "short", day: "numeric" }) }) : t("attendees.notSent")}
                          </span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">{t("attendees.preview")}</p>
              {preview.data ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <dl className="space-y-0.5 border-b border-border bg-muted/40 px-3 py-2 text-xs">
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">{t("attendees.from")}</dt><dd className="min-w-0 truncate">{preview.data.from}</dd></div>
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">{t("attendees.replyTo")}</dt><dd className="min-w-0 truncate">{preview.data.replyTo}</dd></div>
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">{t("attendees.subject")}</dt><dd className="min-w-0 truncate">{preview.data.subject}</dd></div>
                  </dl>
                  {/* sandbox="" : the preview can't run scripts or navigate. */}
                  <iframe title={t("attendees.previewTitle")} sandbox="" srcDoc={preview.data.html} className="h-80 w-full bg-white md:h-[26rem]" />
                </div>
              ) : (
                <div className="flex h-80 items-center justify-center rounded-xl border border-border"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("attendees.cancel")}</Button>
          {data?.configured && data.notes.length > 0 && (
            <Button
              type="button"
              disabled={selected.size === 0 || noteId === null || send.isPending}
              onClick={() => noteId !== null && send.mutate({ recordingId, noteId, recipients: Array.from(selected), message: message.trim() || undefined })}
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : selected.size === 0 ? t("attendees.choosePeople") : tn("attendees.sendCount", selected.size)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
