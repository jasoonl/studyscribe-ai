import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
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
import { Trans, t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

type Note = { id: number; type: string; content: string; metadata?: Record<string, unknown> | null };

const templateName = (id: NoteTemplateId) => t(`notes.template.${id}.name` as MessageKey);
const templateDescription = (id: NoteTemplateId) => t(`notes.template.${id}.description` as MessageKey);
const NOTE_TYPES = ["summary", "key_concepts", "action_items", "formulas", "study_guide"];

function noteTitle(note: Note) {
  const template = getNoteTemplate(typeof note.metadata?.template === "string" ? note.metadata.template : null);
  if (template) return templateName(template.id);
  if (NOTE_TYPES.includes(note.type)) return t(`notes.type.${note.type}` as MessageKey);
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
  useI18n();
  const utils = trpc.useUtils();
  const preferred = () => resolveNoteTemplate(getPreferredNoteTemplate(audienceKey(audience)), audience).id;
  const [template, setTemplate] = useState<NoteTemplateId>(preferred);
  const generate = trpc.ai.generateStudyNotes.useMutation();
  const autoStarted = useRef(false);

  const run = async (chosen: NoteTemplateId, automatic = false) => {
    try {
      await generate.mutateAsync({ recordingId, template: chosen });
      await utils.ai.getStudyNotes.invalidate({ recordingId });
      toast.success(automatic ? t("notes.autoDone") : t("notes.done"));
    } catch (error) {
      if (!automatic) toast.error(error instanceof Error ? error.message : t("notes.failed"));
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
        <SelectTrigger className="w-full sm:w-64" aria-label={t("notes.templateLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NOTE_TEMPLATES.map(item => (
            <SelectItem key={item.id} value={item.id}>
              <span className="flex flex-col">
                <span>{templateName(item.id)}</span>
                <span className="text-xs text-muted-foreground">{templateDescription(item.id)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={() => run(template)} disabled={!transcriptReady || generate.isPending} className="gap-2">
        {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generate.isPending ? t("notes.writing") : notes?.length ? t("notes.add") : t("notes.generate")}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <AIProgressBar isLoading={generate.isPending} title={t("notes.progressTitle")} description={t("notes.progressText")} />
      {generate.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("notes.errorTitle")}</AlertTitle>
          <AlertDescription>{generate.error.message}</AlertDescription>
        </Alert>
      )}

      {notes && notes.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              <Trans k="notes.anotherAngle" parts={{ link: text => <Link href="/templates" className="font-medium text-primary underline-offset-4 hover:underline">{text}</Link> }} />
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
                <Markdown>{note.content}</Markdown>
              </div>
            </Card>
          ))}
        </>
      ) : (
        <Card className="border-2 border-border p-6">
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <BookOpen className="mb-3 h-8 w-8 text-muted-foreground opacity-50" />
            <p className="font-medium">{t("notes.empty")}</p>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              {transcriptReady ? t("notes.pickTemplate") : t("notes.waitTranscript")}
            </p>
            {picker}
          </div>
        </Card>
      )}

    </div>
  );
}
