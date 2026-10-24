import LanguageSelect, { languageForRequest } from "@/components/LanguageSelect";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, BookOpen, Sparkles, MessageSquare, Download, Edit2, Save, X, Brain, Mail, FileText, ClipboardCheck, Layers3, NotebookPen, Share2 } from "lucide-react";
import { RecordingOrganizer } from "@/components/RecordingOrganizer";
import { CourseDot } from "@/components/CourseDot";
import { ShareRecordingDialog } from "@/components/ShareRecordingDialog";
import { KeepOffline } from "@/components/KeepOffline";
import { StudyNotesPanel } from "@/components/StudyNotesPanel";
import { RecordingBookmarks } from "@/components/RecordingBookmarks";
import { RecordingChapters } from "@/components/RecordingChapters";
import { RecordingSlides, useRecordingSlides } from "@/components/RecordingSlides";
import { AttendeeShare } from "@/components/AttendeeShare";
import { RecordingTasks } from "@/components/RecordingTasks";
import { RecordingFollowUps } from "@/components/RecordingFollowUps";
import { VocabularyField, vocabularyForRequest } from "@/components/VocabularyField";
import { AIProgressBar } from "@/components/AIProgressBar";
import { AudioPlayer } from "@/components/AudioPlayer";
import { FlashcardReview } from "@/components/FlashcardReview";
import { FlashcardLearnMode } from "@/components/FlashcardLearnMode";
import { FlashcardTestMode } from "@/components/FlashcardTestMode";
import { type AudioPlayerHandle } from "@/components/AudioPlayer";
import { type TranscriptSegment } from "@/lib/transcriptSegments";
import { TranscriptView } from "@/components/TranscriptView";
import { TranslateMenu } from "@/components/TranslateDialog";
import { downloadTranscriptExport } from "@/lib/transcriptExports";
import { downloadFlashcardExport } from "@/lib/flashcardExports";
import { formatRecordingDuration } from "@/lib/formatDuration";
import { useState, useEffect, useRef } from "react";
import { Link, useRoute, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDate, t, useI18n } from "@/i18n";

function DetailTags({ tagIds }: { tagIds: number[] }) {
  useI18n();
  const { data: tags } = trpc.tags.list.useQuery();
  const own = (tags ?? []).filter(tag => tagIds.includes(tag.id));
  if (own.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("recording.tags")}>
      {own.map(tag => (
        <li key={tag.id} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs">
          <CourseDot color={tag.color} className="size-1.5" />
          {tag.name}
        </li>
      ))}
    </ul>
  );
}

export default function RecordingDetail() {
  const [, params] = useRoute("/recording/:id");
  const recordingId = params?.id ? parseInt(params.id) : null;
  // /recording/:id?t=754 opens the recording at 12:34 (links from Ask StudyScribe).
  const startParam = new URLSearchParams(useSearch()).get("t");
  const startAt = startParam && /^\d+(\.\d+)?$/.test(startParam) ? Number(startParam) : undefined;
  const { user } = useAuth();
  useI18n();
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState("");
  const [isReviewingFlashcards, setIsReviewingFlashcards] = useState(false);
  const [activeStudyTab, setActiveStudyTab] = useState("transcript");
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const slides = useRecordingSlides(recordingId || 0, !!recordingId);

  const { data: recording, isLoading: recordingLoading } = trpc.recordings.get.useQuery(
    { id: recordingId || 0 },
    { enabled: !!recordingId }
  );

  const { data: transcript, isLoading: transcriptLoading } = trpc.transcription.get.useQuery(
    { recordingId: recordingId || 0 },
    { enabled: !!recordingId }
  );

  // In polling mode (no AssemblyAI webhook secret) recordings.getStatus is
  // what actually advances a job to completion, one check per call -- see
  // its server-side comment. Without something polling it here, a recording
  // opened straight from the library (rather than from the upload flow,
  // which already polls this) could sit at "processing" forever with no way
  // for anything to ever check on it again.
  const utilsForStatusPoll = trpc.useUtils();
  const { data: statusPoll } = trpc.recordings.getStatus.useQuery(
    { id: recordingId || 0 },
    { enabled: !!recordingId && recording?.status === "processing", refetchInterval: 3000 }
  );
  useEffect(() => {
    if (!statusPoll || statusPoll.status === "processing") return;
    utilsForStatusPoll.recordings.get.invalidate({ id: recordingId || 0 });
    utilsForStatusPoll.transcription.get.invalidate({ recordingId: recordingId || 0 });
  }, [statusPoll, recordingId, utilsForStatusPoll]);

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

  const generateFlashcardsMutation = trpc.ai.generateFlashcards.useMutation();
  const updateTranscriptMutation = trpc.transcription.update.useMutation();
  const utils = trpc.useUtils();
  const [retryLanguage, setRetryLanguage] = useState("auto");
  const [retryVocabulary, setRetryVocabulary] = useState<string | null>(null);
  const needsRetry = recording?.status === "failed" || (recording?.status === "processing" && !recording?.transcriptionProviderId);
  // Same query (and cache entry) as RecordingChapters; feeds the player's chapter marks.
  const { data: insights } = trpc.insights.get.useQuery({ recordingId: recordingId || 0 }, { enabled: !!recordingId && recording?.status === "completed" });
  const { data: storedVocabulary } = trpc.vocabulary.get.useQuery({ recordingId: recordingId || 0 }, { enabled: !!recordingId && needsRetry });
  const retryTranscription = trpc.recordings.retryTranscription.useMutation({
    onSuccess: () => {
      toast.success(t("recording.retryStarted"));
      utils.recordings.get.invalidate();
    },
    onError: (error) => toast.error(error.message || t("recording.retryFailed")),
  });

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
      toast.error(t("recording.chatFailed"));
    },
  });

  // Generate contextual starter questions based on transcript content
  const getContextualQuestions = () => {
    if (!transcript?.fullText) {
      return [
        t("recording.q.conceptCheck"),
        t("recording.q.reviewFirst"),
        t("recording.q.threeQuestions"),
        t("recording.q.reviewPlan")
      ];
    }

    const text = transcript.fullText.toLowerCase();
    const questions = [];

    // Detect keywords and suggest relevant questions
    if (text.includes('definition') || text.includes('define')) {
      questions.push(t("recording.q.definitions"));
    }
    if (text.includes('formula') || text.includes('equation')) {
      questions.push(t("recording.q.formulas"));
    }
    if (text.includes('example') || text.includes('case study')) {
      questions.push(t("recording.q.example"));
    }
    if (text.includes('process') || text.includes('step')) {
      questions.push(t("recording.q.steps"));
    }
    if (text.includes('why') || text.includes('reason')) {
      questions.push(t("recording.q.why"));
    }
    if (text.includes('compare') || text.includes('difference')) {
      questions.push(t("recording.q.difference"));
    }

    // Add default questions if not enough specific ones
    if (questions.length === 0) {
      questions.push(t("recording.q.mainConcepts"));
      questions.push(t("recording.q.takeaways"));
    }

    // Add more generic questions to reach 4 total
    if (questions.length < 4) {
      const generic = [
        t("recording.q.conceptCheck"),
        t("recording.q.threeQuestions"),
        t("recording.q.reviewFirst"),
        t("recording.q.reviewPlan"),
        t("recording.q.misconceptions")
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
          <h1 className="text-2xl font-bold mb-4">{t("recording.notFound")}</h1>
          <Link href="/dashboard">
            <Button>{t("recording.backToLibrary")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const transcriptReady = recording.status === "completed" && !!transcript?.fullText?.trim();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t("recording.back")}
            </Button>
          </Link>
          <h1 className="text-xl font-bold flex-1 ml-4 truncate">{recording.title}</h1>
          <div className="flex items-center gap-2">
          {recording.status === "completed" && (
            <KeepOffline userId={user?.id} recording={{ id: recording.id, title: recording.title }} transcript={transcript} flashcards={flashcards} notes={studyNotes} />
          )}
          <Button variant="outline" size="sm" className="gap-2" aria-label={t("recording.share")} onClick={() => setIsShareDialogOpen(true)}>
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">{t("recording.share")}</span>
          </Button>
          </div>
        </div>
      </header>
      {recordingId && (
        <ShareRecordingDialog
          recordingId={recordingId}
          open={isShareDialogOpen}
          onOpenChange={setIsShareDialogOpen}
        />
      )}

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="container py-8 focus:outline-none">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left: Transcript & Notes */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recording Info */}
            <Card className="p-6 border-2 border-border">
              <div className="space-y-4">
                <div>
                  <h2 className="font-semibold text-sm text-muted-foreground mb-1">
                    {t("recording.details")}
                  </h2>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-medium">{t("recording.duration")}</span>{" "}
                      {formatRecordingDuration(recording.duration)}
                    </p>
                    <p>
                      <span className="font-medium">{t("recording.audience")}</span>{" "}
                      {recording.audience === "student" ? t("recording.audienceStudent") : t("recording.audienceProfessional")}
                    </p>
                    <p>
                      <span className="font-medium">{t("recording.status")}</span>{" "}
                      <span className="capitalize px-2 py-1 rounded-full bg-secondary text-xs">
                        {recording.status === "completed" ? t("recording.statusCompleted") : recording.status === "failed" ? t("recording.statusFailed") : recording.status === "processing" ? t("recording.statusProcessing") : recording.status}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium">{t("recording.created")}</span>{" "}
                      {formatDate(recording.createdAt, { dateStyle: "short" })}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                      <span className="font-medium">{t("recording.filedUnder")}</span>
                      <RecordingOrganizer recordingId={recording.id} courseId={recording.courseId} tagIds={recording.tagIds} variant="field" className="-ml-1" />
                      <DetailTags tagIds={recording.tagIds} />
                    </div>
                  </div>
                </div>

                <AttendeeShare recordingId={recording.id} transcriptReady={transcriptReady} />

                {/* Transcription failure + recovery. A "processing" recording with no
                    transcriptionProviderId was never actually submitted to a
                    provider -- there is no in-flight job anything could still be
                    waiting on, so it is stuck exactly like a failed one and needs
                    the same manual nudge, not a spinner that never resolves. */}
                {(recording.status === "failed" ||
                  (recording.status === "processing" && !recording.transcriptionProviderId)) && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>
                      {recording.status === "failed" ? t("retry.failedTitle") : t("retry.neverStartedTitle")}
                    </AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p className="text-xs leading-relaxed">
                        {recording.status === "failed" ? t("retry.stillStoredFailed") : t("retry.stillStored")}
                      </p>
                      <LanguageSelect value={retryLanguage} onChange={setRetryLanguage} id="retry-language" />
                      <VocabularyField
                        key={storedVocabulary ? "loaded" : "loading"}
                        value={retryVocabulary ?? storedVocabulary?.recordingTerms.join("\n") ?? ""}
                        onChange={setRetryVocabulary}
                        id="retry-vocabulary"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryTranscription.isPending}
                        onClick={() =>
                          retryTranscription.mutate({
                            id: recording.id,
                            language: languageForRequest(retryLanguage),
                            ...(retryVocabulary !== null ? { keyterms: vocabularyForRequest(retryVocabulary) ?? [] } : {}),
                          })
                        }
                      >
                        {retryTranscription.isPending ? t("retry.retrying") : t("retry.button")}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Audio Player */}
                {recording.audioUrl && (
                  <div>
                    <h2 className="font-semibold text-sm text-muted-foreground mb-2">
                      {t("recording.play")}
                    </h2>
                    <AudioPlayer ref={audioPlayerRef} src={recording.audioUrl} title={t("recording.audioTitle")} onTimeUpdate={setPlaybackTime} fallbackDuration={recording.duration ?? undefined} startAt={startAt} segments={Array.isArray(transcript?.segments) ? (transcript.segments as TranscriptSegment[]) : undefined} chapters={insights?.chapters} />
                    <RecordingBookmarks
                      recordingId={recordingId || 0}
                      playbackTime={playbackTime}
                      onSeek={seconds => audioPlayerRef.current?.seekTo(seconds, { play: true })}
                    />
                  </div>
                )}
                {!recording.audioUrl && recording.status === "completed" && (
                  <p className="text-sm text-muted-foreground">{t("recording.audioRemoved")}</p>
                )}

                <RecordingChapters
                  recordingId={recording.id}
                  transcriptReady={transcriptReady}
                  hasAudio={!!recording.audioUrl}
                  playbackTime={playbackTime}
                  onSeek={seconds => audioPlayerRef.current?.seekTo(seconds, { play: true })}
                />

                <RecordingSlides
                  slides={slides}
                  playbackTime={playbackTime}
                  onSeek={recording.audioUrl ? seconds => audioPlayerRef.current?.seekTo(seconds, { play: true }) : undefined}
                />
              </div>
            </Card>

            {/* Tabs: source material, flashcard review, and separate mastery modes */}
            <Tabs id="recording-study-tabs" value={activeStudyTab} onValueChange={setActiveStudyTab} className="w-full scroll-mt-20">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-none bg-transparent p-0 sm:grid-cols-3">
                <TabsTrigger value="transcript" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <FileText className="h-5 w-5" />
                  <span>{t("recording.tabTranscript")}</span>
                  <span className="hidden text-[11px] font-normal opacity-90 sm:block">{t("recording.tabTranscriptHint")}</span>
                </TabsTrigger>
                <TabsTrigger value="notes" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <NotebookPen className="h-5 w-5" />
                  <span>{t("recording.tabNotes")}</span>
                  <span className="hidden text-[11px] font-normal opacity-90 sm:block">{t("recording.tabNotesHint")}</span>
                </TabsTrigger>
                <TabsTrigger value="flashcards" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <Layers3 className="h-5 w-5" />
                  <span>{t("recording.tabFlashcards")}</span>
                  <span className="hidden text-[11px] font-normal opacity-90 sm:block">{t("recording.tabFlashcardsHint")}</span>
                </TabsTrigger>
                <TabsTrigger value="learn" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <Brain className="h-5 w-5" />
                  <span>{t("recording.tabLearn")}</span>
                  <span className="hidden text-[11px] font-normal opacity-90 sm:block">{t("recording.tabLearnHint")}</span>
                </TabsTrigger>
                <TabsTrigger value="test" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <ClipboardCheck className="h-5 w-5" />
                  <span>{t("recording.tabTest")}</span>
                  <span className="hidden text-[11px] font-normal opacity-90 sm:block">{t("recording.tabTestHint")}</span>
                </TabsTrigger>
                <TabsTrigger value="tutor" className="h-auto min-h-20 flex-col whitespace-normal rounded-xl border border-border bg-card px-2 py-3 text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg sm:min-h-24 sm:px-3 sm:text-sm">
                  <MessageSquare className="h-5 w-5" />
                  <span>{t("recording.tabTutor")}</span>
                  <span className="hidden text-[11px] font-normal opacity-90 sm:block">{t("recording.tabTutorHint")}</span>
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
                        <h3 className="font-semibold">{t("recording.fullTranscript")}</h3>
                        <div className="flex gap-2">
                          {!isEditingTranscript && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setIsEditingTranscript(true)}
                              className="gap-2"
                            >
                              <Edit2 className="w-4 h-4" />
                              {t("recording.edit")}
                            </Button>
                          )}
                          {!(Array.isArray(transcript.segments) && transcript.segments.length > 0) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadTranscriptExport({ segments: [], fullText: transcript.fullText, title: recording?.title || t("recording.transcriptFileName") }, "txt")}
                              className="gap-2"
                            >
                              <Download className="w-4 h-4" />
                              {t("recording.export")}
                            </Button>
                          )}
                        </div>
                      </div>
                      {isEditingTranscript ? (
                        <div className="space-y-3">
                          <textarea
                            value={editedTranscript}
                            onChange={(e) => setEditedTranscript(e.target.value)}
                            className="w-full h-64 p-3 border border-border rounded-lg bg-background text-foreground font-mono text-sm resize-none"
                            placeholder={t("recording.editPlaceholder")}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-accent hover:bg-accent/90 text-primary gap-2"
                              disabled={updateTranscriptMutation.isPending}
                              onClick={async () => {
                                if (!editedTranscript.trim()) {
                                  toast.error(t("recording.transcriptEmpty"));
                                  return;
                                }

                                try {
                                  await updateTranscriptMutation.mutateAsync({
                                    recordingId: recordingId || 0,
                                    fullText: editedTranscript,
                                  });
                                  await utils.transcription.get.invalidate({ recordingId: recordingId || 0 });
                                  setIsEditingTranscript(false);
                                  toast.success(t("recording.transcriptSaved"));
                                } catch (error) {
                                  const message = error instanceof Error ? error.message : t("recording.transcriptSaveFailed");
                                  toast.error(message);
                                }
                              }}
                            >
                              {updateTranscriptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              {updateTranscriptMutation.isPending ? t("recording.saving") : t("recording.saveChanges")}
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
                              {t("recording.cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {Array.isArray(transcript.segments) && transcript.segments.length > 0 ? (
                            <TranscriptView
                              recordingId={recordingId || 0}
                              title={recording.title}
                              segments={transcript.segments as TranscriptSegment[]}
                              fullText={transcript.fullText}
                              hasAudio={!!recording.audioUrl}
                              playbackTime={playbackTime}
                              onSeek={seconds => audioPlayerRef.current?.seekTo(seconds, { play: true })}
                              annotations
                              translatable
                              slides={slides}
                            />
                          ) : (
                            <>
                              {transcript.fullText.trim() && recordingId ? (
                                <div className="flex justify-end">
                                  <TranslateMenu kind="transcript" id={recordingId} variant="outline" />
                                </div>
                              ) : null}
                              <div className="prose prose-sm max-w-none dark:prose-invert">
                                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                  {transcript.fullText}
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>{t("recording.transcriptPending")}</p>
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* Study Notes Tab: kept mounted so a finished transcript gets notes
                  automatically even while another tab is open. */}
              <TabsContent value="notes" forceMount className="data-[state=inactive]:hidden">
                <StudyNotesPanel
                  recordingId={recordingId || 0}
                  audience={recording.audience}
                  transcriptReady={transcriptReady}
                  notes={studyNotes}
                />
              </TabsContent>

              {/* Flashcards Tab */}
              <TabsContent value="flashcards">
                <div className="space-y-4">
                  <AIProgressBar
                    isLoading={generateFlashcardsMutation.isPending}
                    title={t("recording.generatingFlashcards")}
                    description={t("recording.generatingFlashcardsText")}
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
                        <Card className="border-2 border-primary/20 bg-primary/5 p-5 dark:bg-primary/15">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="font-bold">{t("recording.recallTitle")}</h3>
                              <p className="mt-1 text-sm text-muted-foreground">{t("recording.recallText")}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadFlashcardExport(flashcards, "tsv", recording.title)}>
                                <Download className="h-4 w-4" /> Quizlet / Anki
                              </Button>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadFlashcardExport(flashcards, "markdown", recording.title)}>
                                <Download className="h-4 w-4" /> Notion Markdown
                              </Button>
                              <Button className="shrink-0 gap-2" onClick={() => setIsReviewingFlashcards(true)}>
                                <Brain className="h-4 w-4" /> {t("recording.startReview")}
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
                                    {t("recording.question")}
                                  </h4>
                                  <p className="text-sm font-medium">{card.question}</p>
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                                    {t("recording.answer")}
                                  </h4>
                                  <p className="text-sm text-muted-foreground">{card.answer}</p>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs px-2 py-1 rounded-full bg-secondary capitalize">
                                    {card.difficulty === "easy" ? t("recording.difficultyEasy") : card.difficulty === "hard" ? t("recording.difficultyHard") : card.difficulty === "medium" ? t("recording.difficultyMedium") : card.difficulty}
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
                        {t("recording.noFlashcards")}
                      </p>
                      <Button
                        className="bg-accent hover:bg-accent/90 text-primary"
                        onClick={async () => {
                          try {
                            await generateFlashcardsMutation.mutateAsync({
                              recordingId: recordingId || 0,
                            });
                            await utils.ai.getFlashcards.invalidate({ recordingId: recordingId || 0 });
                            toast.success(t("recording.flashcardsGenerated"));
                          } catch (error) {
                            console.error("Failed to generate flashcards:", error);
                            const errorMsg = error instanceof Error ? error.message : t("recording.unknownError");
                            toast.error(t("recording.flashcardsFailed", { error: errorMsg }));
                          }
                        }}
                        disabled={generateFlashcardsMutation.isPending}
                      >
                        {generateFlashcardsMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        {generateFlashcardsMutation.isPending ? t("recording.generating") : t("recording.generateFlashcards")}
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
                    <h3 className="font-bold">{t("recording.learnEmptyTitle")}</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("recording.learnEmptyText")}</p>
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
                    <h3 className="font-bold">{t("recording.testEmptyTitle")}</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("recording.testEmptyText")}</p>
                  </Card>
                )}
              </TabsContent>

              {/* AI Tutor Tab */}
              <TabsContent value="tutor">
                <Card className="p-6 border-2 border-border">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-accent" />
                    {t("recording.tutorTitle")}
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
                    placeholder={t("recording.tutorPlaceholder")}
                    suggestedPrompts={getContextualQuestions()}
                  />
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          {/* Right sidebar: AI Tools */}
          <div className="space-y-4">
            <RecordingTasks
              recordingId={recording.id}
              transcriptReady={transcriptReady}
              audience={recording.audience}
              onSeek={recording.audioUrl ? seconds => audioPlayerRef.current?.seekTo(seconds, { play: true }) : undefined}
            />
            <RecordingFollowUps
              recordingId={recording.id}
              transcriptReady={transcriptReady}
              audience={recording.audience}
              flashcardCount={flashcards?.length ?? 0}
              onOpenFlashcards={() => {
                setActiveStudyTab("flashcards");
                document.getElementById("recording-study-tabs")?.scrollIntoView({ block: "start" });
              }}
            />
            <div className="flex items-center justify-between pt-2">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">{t("recording.aiTools")}</h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{t("recording.requiresTranscript")}</span>
            </div>

            <Link href={`/recordings/${recordingId}/study-guides`}>
              <div className="group p-4 rounded-xl border border-border bg-card hover:border-primary/60 hover:bg-primary/5 transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-primary/70" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t("recording.studyGuides")}</p>
                    <p className="text-xs text-muted-foreground">{t("recording.studyGuidesText")}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 group-hover:border-primary/50 mt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("recording.openStudyGuides")}
                </Button>
              </div>
            </Link>

            <Link href={`/recordings/${recordingId}/quizzes`}>
              <div className="group p-4 rounded-xl border border-border bg-card hover:border-primary/60 hover:bg-primary/5 transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-primary/70" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t("recording.quizzes")}</p>
                    <p className="text-xs text-muted-foreground">{t("recording.quizzesText")}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 group-hover:border-primary/50 mt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("recording.openQuizzes")}
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
                    <p className="font-medium text-sm">{t("recording.emailDrafts")}</p>
                    <p className="text-xs text-muted-foreground">{t("recording.emailDraftsText")}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 group-hover:border-blue-400/50 mt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("recording.openEmailDrafts")}
                </Button>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
