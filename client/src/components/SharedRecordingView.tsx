import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/AudioPlayer";
import { TranscriptView } from "@/components/TranscriptView";
import { useRecordingSlides } from "@/components/RecordingSlides";
import { FileText, BookOpen, Layers3, ClipboardCheck, NotebookPen, Loader2, Pencil } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatTranscriptTimestamp, type TranscriptSegment } from "@/lib/transcriptSegments";
import { PRESSABLE_FOCUS, pressable } from "@/lib/pressable";
import { roleAllows, type AccessRole } from "@shared/sharing";
import { t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

const NOTE_TYPES = ["summary", "key_concepts", "action_items", "formulas", "study_guide"];
const noteTypeLabel = (type: string) => (NOTE_TYPES.includes(type) ? t(`notes.type.${type}` as MessageKey) : type.replace(/_/g, " "));

/** Plain-text transcript editing for people with the edit role (same procedure the owner uses). */
function TranscriptTextEditor({ recordingId, fullText, onClose }: { recordingId: number; fullText: string; onClose: () => void }) {
  useI18n();
  const utils = trpc.useUtils();
  const [text, setText] = useState(fullText);
  const update = trpc.transcription.update.useMutation({
    onSuccess: async () => {
      await utils.sharing.getSharedWithMe.invalidate({ recordingId });
      toast.success(t("shared.view.saved"));
      onClose();
    },
    onError: error => toast.error(error.message || t("shared.view.saveFailed")),
  });
  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={event => setText(event.target.value)}
        aria-label={t("shared.view.textLabel")}
        className="h-72 w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-sm text-foreground"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={!text.trim() || update.isPending} onClick={() => update.mutate({ recordingId, fullText: text })}>
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("shared.view.saveChanges")}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          {t("shared.view.cancel")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("shared.view.editorHint")}</p>
    </div>
  );
}

type SharedBundle = {
  recording: {
    id: number;
    title: string;
    description: string | null;
    audioUrl: string;
    duration: number | null;
    createdAt: string | Date;
  };
  transcript: {
    fullText: string;
    segments: Array<{ id: string; start: number; end: number; text: string; speaker?: string }> | null;
  } | null;
  studyNotes: Array<{ id: number; type: string; content: string }>;
  flashcards: Array<{ id: number; question: string; answer: string }>;
  studyGuides: Array<{ id: number; title: string; content: string }>;
  quizzes: Array<{
    id: number;
    title: string;
    questions: Array<{
      id: string;
      question: string;
      type: "multiple-choice" | "short-answer";
      options?: string[];
      correctAnswer: string;
      explanation: string;
    }> | null;
  }>;
};

function FlashcardItem({ question, answer }: { question: string; answer: string }) {
  useI18n();
  const [revealed, setRevealed] = useState(false);
  return (
    <Card
      className={`p-4 cursor-pointer select-none hover:border-accent transition-colors ${PRESSABLE_FOCUS}`}
      {...pressable(() => setRevealed((r) => !r))}
      aria-expanded={revealed}
    >
      <p className="text-sm font-medium mb-1">{question}</p>
      {revealed ? (
        <p className="text-sm text-muted-foreground">{answer}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">{t("shared.view.reveal")}</p>
      )}
    </Card>
  );
}

export function SharedRecordingView({ bundle, role }: { bundle: SharedBundle; role?: AccessRole }) {
  useI18n();
  const { recording, transcript, studyNotes, flashcards, studyGuides, quizzes } = bundle;
  const playerRef = useRef<AudioPlayerHandle>(null);
  // Slides need a signed-in viewer; public links leave them out.
  const slides = useRecordingSlides(bundle.recording.id, !!role);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [editing, setEditing] = useState(false);
  const segments = (transcript?.segments ?? []) as TranscriptSegment[];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{recording.title}</h1>
        {recording.description && <p className="mt-1 text-muted-foreground">{recording.description}</p>}
        <p className="mt-2 text-sm text-muted-foreground">{role ? t(`shared.view.role.${role}`) : t("shared.view.readOnly")}</p>
      </div>

      {recording.audioUrl ? (
        <Card className="p-4">
          <AudioPlayer
            ref={playerRef}
            src={recording.audioUrl}
            title={recording.title}
            fallbackDuration={recording.duration ?? undefined}
            onTimeUpdate={role ? setPlaybackTime : undefined}
            segments={segments.length ? segments : undefined}
          />
        </Card>
      ) : (
        <Card className="p-4 text-sm text-muted-foreground">{t("recording.audioRemoved")}</Card>
      )}

      <Tabs defaultValue="transcript" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
          <TabsTrigger value="transcript" className="gap-1.5 text-xs sm:text-sm">
            <FileText className="w-4 h-4" /> {t("shared.view.tabTranscript")}
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5 text-xs sm:text-sm">
            <NotebookPen className="w-4 h-4" /> {t("shared.view.tabNotes")}
          </TabsTrigger>
          <TabsTrigger value="flashcards" className="gap-1.5 text-xs sm:text-sm">
            <Layers3 className="w-4 h-4" /> {t("shared.view.tabFlashcards")}
          </TabsTrigger>
          <TabsTrigger value="study" className="gap-1.5 text-xs sm:text-sm">
            <BookOpen className="w-4 h-4" /> {t("shared.view.tabStudy")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-4">
          <Card className="p-4 sm:p-6">
            {role && transcript && roleAllows(role, "edit") && (
              <div className="mb-4 flex justify-end">
                {!editing && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" />
                    {t("shared.view.editText")}
                  </Button>
                )}
              </div>
            )}
            {editing && transcript ? (
              <TranscriptTextEditor recordingId={recording.id} fullText={transcript.fullText} onClose={() => setEditing(false)} />
            ) : role && segments.length ? (
              <TranscriptView
                recordingId={recording.id}
                title={recording.title}
                segments={segments}
                fullText={transcript?.fullText ?? ""}
                hasAudio={!!recording.audioUrl}
                playbackTime={playbackTime}
                onSeek={seconds => playerRef.current?.seekTo(seconds, { play: true })}
                annotations={roleAllows(role, "comment")}
                canRenameSpeakers={roleAllows(role, "edit")}
                showKeyTerms={false}
                slides={slides}
              />
            ) : transcript?.segments?.length ? (
              <div className="space-y-3">
                {transcript.segments.map((seg) => (
                  <div key={seg.id} className="flex gap-3 text-sm">
                    <span className="text-muted-foreground shrink-0 font-mono text-xs pt-0.5">
                      {formatTranscriptTimestamp(seg.start)}
                    </span>
                    <p>
                      {seg.speaker && <span className="font-semibold mr-1">{seg.speaker}:</span>}
                      {seg.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : transcript?.fullText ? (
              <p className="text-sm whitespace-pre-wrap">{transcript.fullText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("shared.view.noTranscript")}</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4 space-y-4">
          {studyNotes.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">{t("shared.view.noNotes")}</Card>
          ) : (
            studyNotes.map((note) => (
              <Card key={note.id} className="p-6">
                <Badge variant="outline" className="mb-3 capitalize">{noteTypeLabel(note.type)}</Badge>
                <div className="text-sm">
                  <Markdown>{note.content}</Markdown>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="flashcards" className="mt-4">
          {flashcards.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">{t("shared.view.noCards")}</Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {flashcards.map((card) => (
                <FlashcardItem key={card.id} question={card.question} answer={card.answer} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="study" className="mt-4 space-y-6">
          {studyGuides.length === 0 && quizzes.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">{t("shared.view.noGuides")}</Card>
          ) : (
            <>
              {studyGuides.map((guide) => (
                <Card key={guide.id} className="p-6">
                  <h3 className="font-semibold mb-3">{guide.title}</h3>
                  <div className="text-sm">
                    <Markdown>{guide.content}</Markdown>
                  </div>
                </Card>
              ))}
              {quizzes.map((quiz) => (
                <Card key={quiz.id} className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-semibold">{quiz.title}</h3>
                  </div>
                  <div className="space-y-4">
                    {(quiz.questions ?? []).map((q, i) => (
                      <div key={q.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
                        <p className="text-sm font-medium mb-2">{i + 1}. {q.question}</p>
                        {q.options && (
                          <ul className="space-y-1 mb-2">
                            {q.options.map((opt) => (
                              <li
                                key={opt}
                                className={`text-sm px-2 py-1 rounded ${
                                  opt === q.correctAnswer ? "bg-green-50 text-green-700 font-medium" : "text-muted-foreground"
                                }`}
                              >
                                {opt}
                              </li>
                            ))}
                          </ul>
                        )}
                        {!q.options && (
                          <p className="text-sm text-green-700 font-medium mb-1">{t("shared.view.answer", { answer: q.correctAnswer })}</p>
                        )}
                        {q.explanation && (
                          <p className="text-xs text-muted-foreground italic">{q.explanation}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
