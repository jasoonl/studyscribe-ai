import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudioPlayer } from "@/components/AudioPlayer";
import { FileText, BookOpen, Layers3, ClipboardCheck, NotebookPen } from "lucide-react";
import { Streamdown } from "streamdown";
import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";

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
  const [revealed, setRevealed] = useState(false);
  return (
    <Card
      className="p-4 cursor-pointer select-none hover:border-accent transition-colors"
      onClick={() => setRevealed((r) => !r)}
    >
      <p className="text-sm font-medium mb-1">{question}</p>
      {revealed ? (
        <p className="text-sm text-muted-foreground">{answer}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Click to reveal answer</p>
      )}
    </Card>
  );
}

export function SharedRecordingView({ bundle }: { bundle: SharedBundle }) {
  const { recording, transcript, studyNotes, flashcards, studyGuides, quizzes } = bundle;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <Badge variant="outline" className="mb-2">Shared recording &middot; read-only</Badge>
        <h1 className="text-2xl font-bold">{recording.title}</h1>
        {recording.description && (
          <p className="text-muted-foreground mt-1">{recording.description}</p>
        )}
      </div>

      <Card className="p-4">
        <AudioPlayer src={recording.audioUrl} title={recording.title} fallbackDuration={recording.duration ?? undefined} />
      </Card>

      <Tabs defaultValue="transcript" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
          <TabsTrigger value="transcript" className="gap-1.5 text-xs sm:text-sm">
            <FileText className="w-4 h-4" /> Transcript
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5 text-xs sm:text-sm">
            <NotebookPen className="w-4 h-4" /> Notes
          </TabsTrigger>
          <TabsTrigger value="flashcards" className="gap-1.5 text-xs sm:text-sm">
            <Layers3 className="w-4 h-4" /> Flashcards
          </TabsTrigger>
          <TabsTrigger value="study" className="gap-1.5 text-xs sm:text-sm">
            <BookOpen className="w-4 h-4" /> Study Guides
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-4">
          <Card className="p-6">
            {transcript?.segments?.length ? (
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
              <p className="text-sm text-muted-foreground">No transcript available.</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4 space-y-4">
          {studyNotes.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No study notes generated for this recording.</Card>
          ) : (
            studyNotes.map((note) => (
              <Card key={note.id} className="p-6">
                <Badge variant="outline" className="mb-3 capitalize">{note.type.replace(/_/g, " ")}</Badge>
                <div className="text-sm">
                  <Streamdown>{note.content}</Streamdown>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="flashcards" className="mt-4">
          {flashcards.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No flashcards generated for this recording.</Card>
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
            <Card className="p-6 text-sm text-muted-foreground">No study guides or quizzes generated for this recording.</Card>
          ) : (
            <>
              {studyGuides.map((guide) => (
                <Card key={guide.id} className="p-6">
                  <h3 className="font-semibold mb-3">{guide.title}</h3>
                  <div className="text-sm">
                    <Streamdown>{guide.content}</Streamdown>
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
                          <p className="text-sm text-green-700 font-medium mb-1">Answer: {q.correctAnswer}</p>
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
