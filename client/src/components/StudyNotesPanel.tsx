import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { AlertCircle, BookOpen, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIProgressBar } from "@/components/AIProgressBar";
import { SendToMenu } from "@/components/SendToMenu";
import { TranslateMenu } from "@/components/TranslateDialog";
import { trpc } from "@/lib/trpc";
import { claimAutoNotesAttempt, getAutoNotesEnabled } from "@/lib/preferences";
import { NOTE_TEMPLATES, audienceKey, getNoteTemplate, resolveNoteTemplate, type NoteTemplateId } from "@shared/noteTemplates";
import { getPreferredNoteTemplate } from "@/lib/preferences";

type Note = { id: number; type: string; content: string; metadata?: Record<string, unknown> | null };

function noteTitle(note: Note) {
  const template = getNoteTemplate(typeof note.metadata?.template === "string" ? note.metadata.template : null);
  if (template) return template.label;
  const words = note.type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StudyNotesPanel({
  recordingId,
  audience,
  transcriptReady,
  notes,
}: {
  recordingId: number;
  audience: string | null;
  transcriptReady: boolean;
  notes: Note[] | undefined;
}) {
  const utils = trpc.useUtils();
  const preferred = () => resolveNoteTemplate(getPreferredNoteTemplate(audienceKey(audience)), audience).id;
  const [template, setTemplate] = useState<NoteTemplateId>(preferred);
  const generate = trpc.ai.generateStudyNotes.useMutation();
  const autoStarted = useRef(false);

  const run = async (chosen: NoteTemplateId, automatic = false) => {
    try {
      await generate.mutateAsync({ recordingId, template: chosen });
      await utils.ai.getStudyNotes.invalidate({ recordingId });
      toast.success(automatic ? "Notes were created from your transcript" : "Notes generated");
    } catch (error) {
      if (!automatic) toast.error(error instanceof Error ? error.message : "Could not generate notes");
    }
  };

  // First visit to a finished recording with no notes: write them right away.
  useEffect(() => {
    if (autoStarted.current || !transcriptReady || !notes || notes.length > 0) return;
    if (!getAutoNotesEnabled() || !claimAutoNotesAttempt(recordingId)) return;
    autoStarted.current = true;
    void run(preferred(), true);
  }, [transcriptReady, notes, recordingId, audience]);

  const picker = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={template} onValueChange={value => setTemplate(value as NoteTemplateId)}>
        <SelectTrigger className="w-full sm:w-64" aria-label="Note template">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NOTE_TEMPLATES.map(item => (
            <SelectItem key={item.id} value={item.id}>
              <span className="flex flex-col">
                <span>{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.description}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={() => run(template)} disabled={!transcriptReady || generate.isPending} className="gap-2">
        {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generate.isPending ? "Writing notes..." : notes?.length ? "Add notes" : "Generate notes"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <AIProgressBar isLoading={generate.isPending} title="Writing your notes" description="Reading the transcript and organising it with the template you chose." />
      {generate.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Notes could not be generated</AlertTitle>
          <AlertDescription>{generate.error.message}</AlertDescription>
        </Alert>
      )}

      {notes && notes.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Need a different angle? Write another set with a template, or{" "}
              <Link href="/templates" className="font-medium text-primary underline-offset-4 hover:underline">browse templates</Link>.
            </p>
            {picker}
          </div>
          {notes.map(note => (
            <Card key={note.id} className="border-2 border-border p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-bold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {noteTitle(note)}
                </h3>
                <div className="flex shrink-0 items-center gap-1">
                <SendToMenu kind="note" id={note.id} />
                <TranslateMenu kind="note" id={note.id} />
                </div>
              </div>
              <div className="prose prose-sm max-w-none text-foreground/90 dark:prose-invert">
                <Streamdown>{note.content}</Streamdown>
              </div>
            </Card>
          ))}
        </>
      ) : (
        <Card className="border-2 border-border p-6">
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <BookOpen className="mb-3 h-8 w-8 text-muted-foreground opacity-50" />
            <p className="font-medium">No notes yet</p>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              {transcriptReady ? "Pick a template that fits this recording." : "Notes can be written once the transcript is ready."}
            </p>
            {picker}
          </div>
        </Card>
      )}

    </div>
  );
}
