import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { AlertCircle, BookOpen, Copy, Languages, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIProgressBar } from "@/components/AIProgressBar";
import { trpc } from "@/lib/trpc";
import { claimAutoNotesAttempt, getAutoNotesEnabled } from "@/lib/preferences";
import { NOTE_TEMPLATES, defaultNoteTemplate, getNoteTemplate, type NoteTemplateId } from "@shared/noteTemplates";
import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";

type Note = { id: number; type: string; content: string; metadata?: Record<string, unknown> | null };

const LANGUAGES = TRANSCRIPTION_LANGUAGES.map(language => ({ code: language.code, label: language.label.replace(/ \(.*\)/, "") }));

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
  const [template, setTemplate] = useState<NoteTemplateId>(() => defaultNoteTemplate(audience).id);
  const [translation, setTranslation] = useState<{ title: string; language: string; content: string } | null>(null);
  const generate = trpc.ai.generateStudyNotes.useMutation();
  const translate = trpc.ai.translateNote.useMutation();
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
    void run(defaultNoteTemplate(audience).id, true);
  }, [transcriptReady, notes, recordingId, audience]);

  const translateNote = async (note: Note, language: (typeof LANGUAGES)[number]) => {
    try {
      const result = await translate.mutateAsync({ noteId: note.id, language: language.code });
      setTranslation({ title: noteTitle(note), language: language.label, content: result.content });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not translate this note");
    }
  };

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
            <p className="text-sm text-muted-foreground">Need a different angle? Write another set with a template.</p>
            {picker}
          </div>
          {notes.map(note => (
            <Card key={note.id} className="border-2 border-border p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-bold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {noteTitle(note)}
                </h3>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2" disabled={translate.isPending}>
                      {translate.isPending && translate.variables?.noteId === note.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                      Translate
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                    {LANGUAGES.map(language => (
                      <DropdownMenuItem key={language.code} onSelect={() => translateNote(note, language)}>
                        {language.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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

      <Dialog open={!!translation} onOpenChange={open => { if (!open) setTranslation(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{translation?.title} in {translation?.language}</DialogTitle>
            <DialogDescription>Machine translation of your notes. It is not saved; copy it if you want to keep it.</DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Streamdown>{translation?.content ?? ""}</Streamdown>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="gap-2"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(translation?.content ?? "");
                  toast.success("Translation copied");
                } catch {
                  toast.error("Copy failed. Select the text and copy it instead.");
                }
              }}
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
