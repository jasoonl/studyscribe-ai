import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, BookOpen, Sparkles, MessageSquare, Download, Edit2, Save, X } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useRoute } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function RecordingDetail() {
  const [, params] = useRoute("/recording/:id");
  const recordingId = params?.id ? parseInt(params.id) : null;
  const { user } = useAuth();
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState("");

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

  const { data: chatHistory } = trpc.ai.getChatHistory.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId }
  );

  const generateStudyNotesMutation = trpc.ai.generateStudyNotes.useMutation();
  const generateFlashcardsMutation = trpc.ai.generateFlashcards.useMutation();
  const assistantChatMutation = trpc.ai.assistantChat.useMutation();

  // Generate contextual starter questions based on transcript content
  const getContextualQuestions = () => {
    if (!transcript?.fullText) {
      return [
        "Explain the main concepts",
        "What are the key takeaways?",
        "Can you give me an example?",
        "How does this relate to real-world applications?"
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
        "Can you give me an example?",
        "How does this relate to real-world applications?",
        "What should I focus on for studying?",
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
        <div className="grid lg:grid-cols-3 gap-8">
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
                    <audio
                      controls
                      className="w-full"
                      src={recording.audioUrl}
                    >
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}
              </div>
            </Card>

            {/* Tabs: Transcript, Notes, Flashcards, Assistant */}
            <Tabs defaultValue="transcript" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                <TabsTrigger value="notes">Study Notes</TabsTrigger>
                <TabsTrigger value="flashcards">Flashcards</TabsTrigger>
                <TabsTrigger value="tutor">AI Assistant</TabsTrigger>
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
                              onClick={() => {
                                setIsEditingTranscript(false);
                                // TODO: Save edited transcript to backend
                              }}
                            >
                              <Save className="w-4 h-4" />
                              Save Changes
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
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            {transcript.fullText}
                          </p>
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
                            // Refetch study notes
                            window.location.reload();
                          } catch (error) {
                            console.error("Failed to generate study notes:", error);
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
                  {flashcards && flashcards.length > 0 ? (
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
                            // Refetch flashcards
                            window.location.reload();
                          } catch (error) {
                            console.error("Failed to generate flashcards:", error);
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

              {/* AI Tutor Tab */}
              <TabsContent value="tutor">
                <Card className="p-6 border-2 border-border">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-accent" />
                    AI Tutor - Ask questions about this lecture
                  </h3>
                  <AIChatBox
                    messages={chatHistory?.map(m => ({
                      role: m.role as 'user' | 'assistant',
                      content: m.content,
                    })) || []}
                    onSendMessage={async (content) => {
                      try {
                        await assistantChatMutation.mutateAsync({
                          recordingId: recordingId || 0,
                          message: content,
                        });
                        // Refetch chat history after mutation
                        const utils = trpc.useUtils();
                        await utils.ai.getChatHistory.invalidate({ recordingId: recordingId || 0 });
                      } catch (error) {
                        console.error('Failed to send message:', error);
                      }
                    }}
                    isLoading={assistantChatMutation.isPending}
                    placeholder="Ask the AI Assistant a question about this lecture..."
                    suggestedPrompts={getContextualQuestions()}
                  />
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
}
