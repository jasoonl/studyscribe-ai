import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, BookOpen, Sparkles, MessageSquare, Download, Edit2, Save, X, Brain, Mail, FileText, ClipboardCheck, Layers3, NotebookPen } from "lucide-react";
import { AIProgressBar } from "@/components/AIProgressBar";
import { AudioPlayer } from "@/components/AudioPlayer";
import { FlashcardReview } from "@/components/FlashcardReview";
import { FlashcardLearnMode } from "@/components/FlashcardLearnMode";
import { FlashcardTestMode } from "@/components/FlashcardTestMode";
import { type AudioPlayerHandle } from "@/components/AudioPlayer";
import { formatTranscriptTimestamp, getActiveTranscriptSegmentIndex, type TranscriptSegment } from "@/lib/transcriptSegments";
import { downloadFlashcardExport } from "@/lib/flashcardExports";
import { useState, useEffect, useRef } from "react";
import { Link, useRoute } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export default function RecordingDetail() {
  const [, params] = useRoute("/recording/:id");
  const recordingId = params?.id ? parseInt(params.id) : null;
  const { user } = useAuth();
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState("");
  const [isReviewingFlashcards, setIsReviewingFlashcards] = useState(false);
  const [activeStudyTab, setActiveStudyTab] = useState("transcript");
  const [playbackTime, setPlaybackTime] = useState(0);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);

  const { data: recording, isLoading: recordingLoading } = trpc.recordings.get.useQuery(
    { id: recordingId || 0 },
    { enabled: !!recordingId }
  );

  const { data: transcript, isLoading: transcriptLoading } = trpc.transcription.get.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId }
  );

  // Update edited transcript when transcript loads
  useEffect(() => {
    if (transcript?.fullText) {
      setEditedTranscript(transcript.fullText);
    }
  }, [transcript?.fullText]);

  const { data: studyNotes } = trpc.ai.getStudyNotes.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId }
  );

  const { data: flashcards } = trpc.ai.getFlashcards.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId }
  );

  const { data: flashcardReviews } = trpc.ai.getFlashcardReviews.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId && !!flashcards?.length }
  );

  const { data: chatHistory } = trpc.ai.getChatHistory.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId }
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  const generateStudyNotesMutation = trpc.ai.generateStudyNotes.useMutation();
  const generateFlashcardsMutation = trpc.ai.generateFlashcards.useMutation();
  const updateTranscriptMutation = trpc.transcription.update.useMutation();
  const utils = trpc.useUtils();

  // Initialize messages from chat history
  useEffect(() => {
    if (chatHistory) {
      setMessages(chatHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })));
    }
  }, [chatHistory]);

  const assistantChatMutation = trpc.ai.assistantChat.useMutation({
    onSuccess: (response) => {
      // Add assistant message to local state
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.message,
      }]);
      setIsLoadingChat(false);
      // Invalidate cache for next refetch
      utils.ai.getChatHistory.invalidate({ recordingId: recordingId || 0 });
    },
    onError: (error) => {
      console.error('Chat failed:', error);
      setIsLoadingChat(false);
      toast.error('Failed to get AI response');
    },
  });

  // Generate contextual starter questions based on transcript content
  const getContextualQuestions = () => {
    if (!transcript?.fullText) {
      return [
        "Give me a 60-second concept check",
        "What should I review first?",
        "Test my understanding with 3 questions",
        "Create a 15-minute review plan"
      ];
    }

    const text = transcript.fullText.toLowerCase();
    const questions = [];

    // Detect keywords and suggest relevant questions
    if (text.includes('definition') || text.includes('define')) {
      questions.push("What are the key definitions?");
    }
    if (text.includes('formula') || text.includes('equation')) {
      questions.push("Can you explain the formulas?");
    }
    if (text.includes('example') || text.includes('case study')) {
      questions.push("Can you walk through an example?");
    }
    if (text.includes('process') || text.includes('step')) {
      questions.push("What are the steps involved?");
    }
    if (text.includes('why') || text.includes('reason')) {
      questions.push("Why is this important?");
    }
    if (text.includes('compare') || text.includes('difference')) {
      questions.push("What's the difference between these concepts?");
    }

    // Add default questions if not enough specific ones
    if (questions.length === 0) {
      questions.push("Explain the main concepts");
      questions.push("What are the key takeaways?");
    }

    // Add more generic questions to reach 4 total
    if (questions.length < 4) {
      const generic = [
        "Give me a 60-second concept check",
        "Test my understanding with 3 questions",
        "What should I review first?",
        "Create a 15-minute review plan",
        "What are common misconceptions?"
      ];
      for (const q of generic) {
        if (questions.length < 4 && !questions.includes(q)) {
          questions.push(q);
        }
      }
    }

    return questions.slice(0, 4);
  };

  if (recordingLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Recording not found</h1>
          <Link href="/dashboard">
            <Button>Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-xl font-bold flex-1 ml-4">{recording.title}</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left: Transcript & Notes */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recording Info */}
            <Card className="p-6 border-2 border-border">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground mb-1">
                    Recording Details
                  </h3>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-medium">Duration:</span>{" "}
                      {recording.duration ? `${Math.round(recording.duration / 60)} minutes` : "N/A"}
                    </p>
                    <p>
                      <span className="font-medium">Audience:</span>{" "}
                      {recording.audience === "student" ? "Student" : "Professional"}
                    </p>
                    <p>
                      <span className="font-medium">Status:</span>{" "}
                      <span className="capitalize px-2 py-1 rounded-full bg-secondary text-xs">
                        {recording.status}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium">Created:</span>{" "}
                      {new Date(recording.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Audio Player */}
                {recording.audioUrl && (
                  <div>
                    <h3 className="font-semibold text-sm text-muted-foreground mb-2">
                      Play Recording
                    </h3>
                    <AudioPlayer ref={audioPlayerRef} src={recording.audioUrl} title="Recording Audio" onTimeUpdate={setPlaybackTime} />
                  </div>
                )}
              </div>
            </Card>

            {/* Tabs: source material, flashcard review, and separate mastery modes */}
            <Tabs value={activeStudyTab} onValueChange={setActiveStudyTab} className="w-full">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-none bg-transparent p-0 sm:grid-cols-3">
                <TabsTrigger value="transcript" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <FileText className="h-5 w-5" />
                  <span>Transcript</span>
                  <span className="hidden text-[10px] font-normal opacity-70 sm:block">Source material</span>
                </TabsTrigger>
                <TabsTrigger value="notes" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <NotebookPen className="h-5 w-5" />
                  <span>Study Notes</span>
                  <span className="hidden text-[10px] font-normal opacity-70 sm:block">Understand</span>
                </TabsTrigger>
                <TabsTrigger value="flashcards" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <Layers3 className="h-5 w-5" />
                  <span>Flashcards</span>
                  <span className="hidden text-[10px] font-normal opacity-70 sm:block">Recall</span>
                </TabsTrigger>
                <TabsTrigger value="learn" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <Brain className="h-5 w-5" />
                  <span>Learn</span>
                  <span className="hidden text-[10px] font-normal opacity-70 sm:block">Build mastery</span>
                </TabsTrigger>
                <TabsTrigger value="test" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <ClipboardCheck className="h-5 w-5" />
                  <span>Test</span>
                  <span className="hidden text-[10px] font-normal opacity-70 sm:block">Check mastery</span>
                </TabsTrigger>
                <TabsTrigger value="tutor" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <MessageSquare className="h-5 w-5" />
                  <span>AI Assistant</span>
                  <span className="hidden text-[10px] font-normal opacity-70 sm:block">Ask questions</span>
                </TabsTrigger>
              </TabsList>

              {/* Transcript Tab */}
              <TabsContent value="transcript">
                <Card className="p-6 border-2 border-border">
                  {transcriptLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : transcript ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold">Full Transcript</h3>
                        <div className="flex gap-2">
                          {!isEditingTranscript && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setIsEditingTranscript(true)}
                              className="gap-2"
                            >
                              <Edit2 className="w-4 h-4" />
                              Edit
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const element = document.createElement("a");
                              element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(transcript.fullText));
                              element.setAttribute("download", `${recording?.title || 'transcript'}.txt`);
                              element.style.display = "none";
                              document.body.appendChild(element);
                              element.click();
                              document.body.removeChild(element);
                            }}
                            className="gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Export
                          </Button>
                        </div>
                      </div>
                      {isEditingTranscript ? (
                        <div className="space-y-3">
                          <textarea
                            value={editedTranscript}
                            onChange={(e) => setEditedTranscript(e.target.value)}
                            className="w-full h-64 p-3 border border-border rounded-lg bg-background text-foreground font-mono text-sm resize-none"
                            placeholder="Edit transcript..."
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-accent hover:bg-accent/90 text-primary gap-2"
                              disabled={updateTranscriptMutation.isPending}
                              onClick={async () => {
                                if (!editedTranscript.trim()) {
                                  toast.error("Transcript cannot be empty");
                                  return;
                                }

                                try {
                                  await updateTranscriptMutation.mutateAsync({
                                    recordingId: recordingId || 0,
                                    fullText: editedTranscript,
                                  });
                                  await utils.transcription.get.invalidate({ recordingId: recordingId || 0 });
                                  setIsEditingTranscript(false);
                                  toast.success("Transcript changes saved");
                                } catch (error) {
                                  const message = error instanceof Error ? error.message : "Unable to save transcript";
                                  toast.error(message);
                                }
                              }}
                            >
                              {updateTranscriptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              {updateTranscriptMutation.isPending ? "Saving..." : "Save Changes"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setIsEditingTranscript(false);
                                setEditedTranscript(transcript.fullText);
                              }}
                              className="gap-2"
                            >
                              <X className="w-4 h-4" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {Array.isArray(transcript.segments) && transcript.segments.length > 0 ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold">Timestamped transcript</p>
                                <p className="text-xs text-muted-foreground">Select a timestamp to play from that point.</p>
                              </div>
                              <div className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2">
                                {(transcript.segments as TranscriptSegment[]).map((segment, index) => {
                                  const isActive = getActiveTranscriptSegmentIndex(transcript.segments as TranscriptSegment[], playbackTime) === index;
                                  return (
                                    <button
                                      key={`${segment.id}-${index}`}
                                      type="button"
                                      disabled={!recording.audioUrl}
                                      onClick={() => audioPlayerRef.current?.seekTo(segment.start, { play: true })}
                                      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                                        isActive ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-background"
                                      }`}
                                    >
                                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${isActive ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                                        {formatTranscriptTimestamp(segment.start)}
                                      </span>
                                      <span className="min-w-0 text-sm leading-relaxed">
                                        {segment.speaker && (
                                          <span className={`mb-1 mr-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${isActive ? "bg-primary-foreground/15 text-primary-foreground" : "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-200"}`}>
                                            {segment.speaker}
                                          </span>
                                        )}
                                        {segment.text}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="prose prose-sm max-w-none dark:prose-invert">
                              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                {transcript.fullText}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>Transcript not yet available</p>
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* Study Notes Tab */}
              <TabsContent value="notes">
                <div className="space-y-4">
                  <AIProgressBar
                    isLoading={generateStudyNotesMutation.isPending}
                    title="Generating Study Notes"
                    description="Analyzing transcript and creating comprehensive study materials..."
                  />
                  {generateStudyNotesMutation.isError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Generation Failed</AlertTitle>
                      <AlertDescription>
                        {generateStudyNotesMutation.error instanceof Error 
                          ? generateStudyNotesMutation.error.message 
                          : "Failed to generate study notes. Please try again."}
                      </AlertDescription>
                    </Alert>
                  )}
                  {studyNotes && studyNotes.length > 0 ? (
                    studyNotes.map((note) => (
                      <Card key={note.id} className="p-6 border-2 border-border">
                        <h3 className="font-bold mb-3 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-accent" />
                          {note.type.replace(/_/g, " ").toUpperCase()}
                        </h3>
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            {note.content}
                          </p>
                        </div>
                      </Card>
                    ))
                  ) : (
                    <Card className="p-6 border-2 border-border text-center">
                      <BookOpen className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground mb-4">
                        No study notes generated yet
                      </p>
                      <Button
                        className="bg-accent hover:bg-accent/90 text-primary"
                        onClick={async () => {
                          try {
                            await generateStudyNotesMutation.mutateAsync({
                              recordingId: recordingId || 0,
                            });
                            await utils.ai.getStudyNotes.invalidate({ recordingId: recordingId || 0 });
                            toast.success("Study notes generated successfully!");
                          } catch (error) {
                            console.error("Failed to generate study notes:", error);
                            const errorMsg = error instanceof Error ? error.message : "Unknown error";
                            toast.error(`Failed to generate study notes: ${errorMsg}`);
                          }
                        }}
                        disabled={generateStudyNotesMutation.isPending}
                      >
                        {generateStudyNotesMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        {generateStudyNotesMutation.isPending ? "Generating..." : "Generate Study Notes"}
                      </Button>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* Flashcards Tab */}
              <TabsContent value="flashcards">
                <div className="space-y-4">
                  <AIProgressBar
                    isLoading={generateFlashcardsMutation.isPending}
                    title="Generating Flashcards"
                    description="Creating interactive flashcards from your transcript..."
                  />
                  {flashcards && flashcards.length > 0 ? (
                    isReviewingFlashcards ? (
                      <FlashcardReview
                        recordingId={recordingId || 0}
                        cards={flashcards}
                        reviews={flashcardReviews}
                        onExit={() => setIsReviewingFlashcards(false)}
                      />
                    ) : (
                      <div className="space-y-4">
                        <Card className="border-2 border-primary/20 bg-gradient-to-r from-cyan-50 to-indigo-50 p-5 dark:from-cyan-950/30 dark:to-indigo-950/30">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="font-bold">Ready to actively recall?</h3>
                              <p className="mt-1 text-sm text-muted-foreground">Study one card at a time, reveal only when ready, and track what you have mastered.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadFlashcardExport(flashcards, "tsv", recording.title)}>
                                <Download className="h-4 w-4" /> Quizlet / Anki
                              </Button>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadFlashcardExport(flashcards, "markdown", recording.title)}>
                                <Download className="h-4 w-4" /> Notion Markdown
                              </Button>
                              <Button className="shrink-0 gap-2" onClick={() => setIsReviewingFlashcards(true)}>
                                <Brain className="h-4 w-4" /> Start review
                              </Button>
                            </div>
                          </div>
                        </Card>
                        <div className="grid gap-4">
                          {flashcards.map((card) => (
                            <Card key={card.id} className="p-4 border-2 border-border">
                              <div className="space-y-3">
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                                    Question
                                  </h4>
                                  <p className="text-sm font-medium">{card.question}</p>
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                                    Answer
                                  </h4>
                                  <p className="text-sm text-muted-foreground">{card.answer}</p>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs px-2 py-1 rounded-full bg-secondary capitalize">
                                    {card.difficulty}
                                  </span>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )
                  ) : (
                    <Card className="p-6 border-2 border-border text-center">
                      <BookOpen className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground mb-4">
                        No flashcards generated yet
                      </p>
                      <Button
                        className="bg-accent hover:bg-accent/90 text-primary"
                        onClick={async () => {
                          try {
                            await generateFlashcardsMutation.mutateAsync({
                              recordingId: recordingId || 0,
                            });
                            await utils.ai.getFlashcards.invalidate({ recordingId: recordingId || 0 });
                            toast.success("Flashcards generated successfully!");
                          } catch (error) {
                            console.error("Failed to generate flashcards:", error);
                            const errorMsg = error instanceof Error ? error.message : "Unknown error";
                            toast.error(`Failed to generate flashcards: ${errorMsg}`);
                          }
                        }}
                        disabled={generateFlashcardsMutation.isPending}
                      >
                        {generateFlashcardsMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        {generateFlashcardsMutation.isPending ? "Generating..." : "Generate Flashcards"}
                      </Button>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* Learn Tab */}
              <TabsContent value="learn">
                {flashcards && flashcards.length > 0 ? (
                  <FlashcardLearnMode
                    recordingId={recordingId || 0}
                    cards={flashcards}
                    reviews={flashcardReviews}
                    onExit={() => setActiveStudyTab("flashcards")}
                  />
                ) : (
                  <Card className="border-2 border-border p-8 text-center">
                    <Brain className="mx-auto mb-3 h-9 w-9 text-muted-foreground/60" />
                    <h3 className="font-bold">Learn from your flashcards</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Generate flashcards first, then Learn Mode will adapt practice from recognition to written recall.</p>
                  </Card>
                )}
              </TabsContent>

              {/* Test Tab */}
              <TabsContent value="test">
                {flashcards && flashcards.length > 0 ? (
                  <FlashcardTestMode
                    cards={flashcards}
                    onExit={() => setActiveStudyTab("flashcards")}
                  />
                ) : (
                  <Card className="border-2 border-border p-8 text-center">
                    <BookOpen className="mx-auto mb-3 h-9 w-9 text-muted-foreground/60" />
                    <h3 className="font-bold">Test your mastery</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Generate flashcards first to unlock a mixed-format practice test for this recording.</p>
                  </Card>
                )}
              </TabsContent>

              {/* AI Tutor Tab */}
              <TabsContent value="tutor">
                <Card className="p-6 border-2 border-border">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-accent" />
                    AI Tutor - Ask questions about this lecture
                  </h3>
                  <AIChatBox
                    messages={messages}
                    onSendMessage={async (content) => {
                      // Optimistically add user message to state
                      setMessages(prev => [...prev, {
                        role: 'user',
                        content: content,
                      }]);
                      setIsLoadingChat(true);
                      
                      // Send to server
                      assistantChatMutation.mutate({
                        recordingId: recordingId || 0,
                        message: content,
                      });
                    }}
                    isLoading={isLoadingChat}
                    placeholder="Ask the AI Assistant a question about this lecture..."
                    suggestedPrompts={getContextualQuestions()}
                  />
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          {/* Right sidebar: AI Tools */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">AI Study Tools</h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Requires transcript</span>
            </div>

            <Link href={`/recordings/${recordingId}/study-guides`}>
              <div className="group p-4 rounded-xl border border-border bg-card hover:border-indigo-400/60 hover:bg-indigo-50/5 transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Study Guides</p>
                    <p className="text-xs text-muted-foreground">AI-generated comprehensive notes with key concepts & formulas</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 group-hover:border-indigo-400/50 mt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Open Study Guides
                </Button>
              </div>
            </Link>

            <Link href={`/recordings/${recordingId}/quizzes`}>
              <div className="group p-4 rounded-xl border border-border bg-card hover:border-purple-400/60 hover:bg-purple-50/5 transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Practice Quizzes</p>
                    <p className="text-xs text-muted-foreground">10 AI-generated questions with instant scoring & explanations</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 group-hover:border-purple-400/50 mt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Open Quizzes
                </Button>
              </div>
            </Link>

            <Link href={`/recordings/${recordingId}/email-drafts`}>
              <div className="group p-4 rounded-xl border border-border bg-card hover:border-blue-400/60 hover:bg-blue-50/5 transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Email Drafts</p>
                    <p className="text-xs text-muted-foreground">Generate emails, documents & reports in your chosen tone</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 group-hover:border-blue-400/50 mt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Open Email Drafts
                </Button>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
