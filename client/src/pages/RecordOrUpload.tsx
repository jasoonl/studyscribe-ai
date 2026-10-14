import LanguageSelect, { languageForRequest } from "@/components/LanguageSelect";
import { VocabularyField, vocabularyForRequest } from "@/components/VocabularyField";
import { CourseSelect, NO_COURSE, courseForRequest } from "@/components/CourseSelect";
import RecordingConsentNotice from "@/components/RecordingConsentNotice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, Mic, Square, Pause, Play, CheckCircle, AlertCircle, UploadCloud, FileAudio, Zap, Link as LinkIcon } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { uploadAudioDirectly } from "@/lib/directAudioUpload";
import { probeAudioDuration } from "@/lib/probeAudioDuration";
import { useRecorder, useShowsRecorder } from "@/contexts/RecorderContext";
import { useSaveSlides } from "@/hooks/useSaveSlides";
import { MarkMoment } from "@/components/MarkMoment";
import { MAX_LINK_IMPORT_LABEL, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@shared/const";
import { PRESSABLE_FOCUS, pressable } from "@/lib/pressable";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import type { LiveTurn } from "@/lib/liveTurns";
import { LiveTextToggle, TabAudioControl, TabAudioOption } from "@/components/live/RecordingOptions";
import { LiveTranscriptSection, useLiveLayout } from "@/components/live/LiveTranscriptSection";
import { StudyHelpPanel } from "@/components/live/StudyHelpPanel";
import { useCalendarEventForRecording, useCalendarTitle } from "@/components/CalendarReminderWatcher";
import { formatNumber, t, useI18n } from "@/i18n";

type Mode = "choose" | "record" | "upload" | "link";

export default function RecordOrUpload({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useCustomAuth();
  useI18n();
  const [, navigate] = useLocation();
  const recorder = useRecorder();
  const live = useLiveTranscript();
  // A recording keeps running while the user is elsewhere; reopen straight onto it.
  const [mode, setMode] = useState<Mode>(() => (recorder.status !== "idle" ? "record" : "choose"));
  useShowsRecorder(mode === "record");

  // Recording state lives in RecorderProvider so it survives leaving this page.
  const isRecording = recorder.status === "recording" || recorder.status === "paused";
  const isPaused = recorder.status === "paused";
  const duration = recorder.elapsedSeconds;
  const [recordingTitle, setRecordingTitle] = useState("");
  const calendarHint = useCalendarTitle(recorder, recordingTitle, setRecordingTitle);
  const calendarLink = useCalendarEventForRecording(recorder);
  const [audience, setAudience] = useState<"student" | "professional">("student");
  const [withTabAudio, setWithTabAudio] = useState(false);
  // Live text kept on screen after upload, until the real transcript replaces it.
  const [liveSnapshot, setLiveSnapshot] = useState<LiveTurn[] | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const recordingStopped = recorder.status === "stopped" || uploadComplete;

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadAudience, setUploadAudience] = useState<"student" | "professional">("student");
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadFileComplete, setUploadFileComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Link import state
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkAudience, setLinkAudience] = useState<"student" | "professional">("student");
  const [language, setLanguage] = useState<string>("auto");
  const [vocabulary, setVocabulary] = useState("");
  // `?course=<id>` (from a course page's "Record" button) preselects the course.
  const [courseChoice, setCourseChoice] = useState<string>(() => {
    try {
      return new URLSearchParams(window.location.search).get("course") ?? NO_COURSE;
    } catch {
      return NO_COURSE;
    }
  });
  const [isImporting, setIsImporting] = useState(false);
  const [linkComplete, setLinkComplete] = useState(false);

  const [createdRecordingId, setCreatedRecordingId] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const createRecordingMutation = trpc.recordings.create.useMutation();
  const saveSlides = useSaveSlides();
  const createFromUrlMutation = trpc.recordings.createFromUrl.useMutation();
  const liveLayout = useLiveLayout(liveSnapshot);

  // Poll for transcription status after upload/record
  const { data: statusData } = trpc.recordings.getStatus.useQuery(
    { id: createdRecordingId! },
    {
      enabled: isPolling && createdRecordingId !== null,
      refetchInterval: isPolling && createdRecordingId !== null ? 3000 : false,
    }
  );

  // Auto-redirect when transcription completes or fails
  useEffect(() => {
    if (!isPolling || !createdRecordingId || !statusData) return;
    if (statusData.status === "completed" || statusData.status === "failed") {
      setIsPolling(false);
      setLiveSnapshot(null);
      navigate(`/recording/${createdRecordingId}`);
    }
  }, [statusData, isPolling, createdRecordingId, navigate]);

  // Offer back a recording that a crash, reload or closed tab interrupted.
  const { restoreUnsaved, recovered } = recorder;
  useEffect(() => {
    if (user) void restoreUnsaved(user.id);
  }, [user, restoreUnsaved]);
  useEffect(() => {
    if (recovered) setMode("record");
  }, [recovered]);

  // Recording functions
  const startRecording = async () => {
    setUploadComplete(false);
    setLiveSnapshot(null);
    const started = await recorder.start({ userId: user?.id ?? null, returnPath: "/record-or-upload", tabAudio: withTabAudio });
    if (started) toast.success(t("record.toast.started"));
  };

  const pauseRecording = () => recorder.pause();

  const resumeRecording = () => recorder.resume();

  const stopRecording = () => {
    void recorder.stop();
  };

  // Helper: read blob/file as base64 DataURL using a Promise (avoids async callback bug)
  const readAsBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(t("record.error.readAudio")));
      reader.readAsDataURL(blob);
    });
  };

  const submitRecording = async () => {
    if (!recordingTitle.trim()) {
      toast.error(t("record.error.titleRequired"));
      return;
    }

    const finished = recorder.getRecording();
    if (!finished) {
      toast.error(t("record.error.noAudio"));
      return;
    }

    setIsUploading(true);
    try {
      const { blob: audioBlob, mimeType, durationSeconds, bookmarks } = finished;
      const extension = mimeType.startsWith("audio/mp4") ? "mp4" : "webm";
      const directUpload = await uploadAudioDirectly(audioBlob, `recording-${Date.now()}.${extension}`);
      const base64String = directUpload ? undefined : await readAsBase64(audioBlob);
      const recording = await createRecordingMutation.mutateAsync({
        title: recordingTitle,
        audience,
        ...(directUpload ? { audioUpload: directUpload } : { audioBase64: base64String! }),
        duration: durationSeconds,
        language: languageForRequest(language),
        keyterms: vocabularyForRequest(vocabulary),
        courseId: courseForRequest(courseChoice),
        bookmarks: bookmarks.map(atSeconds => ({ atSeconds })),
        ...calendarLink,
      });
      setUploadComplete(true);
      if (live.turns.length > 0) setLiveSnapshot(live.turns);
      recorder.discard();
      saveSlides(recording.id, finished.slides);
      setCreatedRecordingId(recording.id);
      setIsPolling(true);
      toast.success(t("record.toast.recordingUploaded"));
      // Fallback redirect after 90 seconds
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      console.error("Failed to upload recording:", error);
      const errorMessage = error instanceof Error ? error.message : t("record.error.uploadRecordingFailed");
      toast.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  // Upload functions
  const validateAndSetFile = (file: File) => {
    const validTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg", "audio/mp4", "audio/webm", "audio/m4a", "audio/x-m4a", "video/quicktime"];
    if (!validTypes.includes(file.type) && !/\.mov$/i.test(file.name)) {
      toast.error(t("record.error.invalidFile"));
      return;
    }

    const maxSize = MAX_UPLOAD_BYTES;
    if (file.size > maxSize) {
      toast.error(t("record.error.fileTooLarge", { size: MAX_UPLOAD_LABEL }));
      return;
    }

    setSelectedFile(file);
    setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    validateAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    validateAndSetFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error(t("record.error.noFile"));
      return;
    }

    if (!uploadTitle.trim()) {
      toast.error(t("record.error.titleRequired"));
      return;
    }

    setIsUploadingFile(true);
    setUploadPercent(0);
    try {
      const [directUpload, duration] = await Promise.all([
        uploadAudioDirectly(selectedFile, selectedFile.name, setUploadPercent),
        probeAudioDuration(selectedFile),
      ]);
      const base64String = directUpload ? undefined : await readAsBase64(selectedFile);
      const recording = await createRecordingMutation.mutateAsync({
        title: uploadTitle,
        audience: uploadAudience,
        ...(directUpload ? { audioUpload: directUpload } : { audioBase64: base64String! }),
        duration,
        language: languageForRequest(language),
        keyterms: vocabularyForRequest(vocabulary),
        courseId: courseForRequest(courseChoice),
      });
      setUploadFileComplete(true);
      setCreatedRecordingId(recording.id);
      setIsPolling(true);
      toast.success(t("record.toast.fileUploaded"));
      // Fallback redirect after 90 seconds
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      console.error("Failed to upload file:", error);
      const errorMessage = error instanceof Error ? error.message : t("record.error.uploadFileFailed");
      toast.error(errorMessage);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleImportLink = async () => {
    if (!linkUrl.trim()) {
      toast.error(t("record.error.linkRequired"));
      return;
    }

    setIsImporting(true);
    try {
      const recording = await createFromUrlMutation.mutateAsync({
        url: linkUrl.trim(),
        title: linkTitle.trim() || undefined,
        audience: linkAudience,
        language: languageForRequest(language),
        keyterms: vocabularyForRequest(vocabulary),
        courseId: courseForRequest(courseChoice),
      });
      setLinkComplete(true);
      setCreatedRecordingId(recording.id);
      setIsPolling(true);
      toast.success(t("record.toast.linkImported"));
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      console.error("Failed to import link:", error);
      toast.error(error instanceof Error ? error.message : t("record.error.linkFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Choose mode
  if (mode === "choose") {
    return (
      <div className={embedded ? "text-foreground" : "min-h-screen bg-background text-foreground"}>
        <header className={`border-b border-border bg-background/95 ${embedded ? "hidden" : "sticky top-0 z-40"}`}>
          <div className="container h-16 flex items-center justify-between">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                {t("record.backToLibrary")}
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{t("record.choose.title")}</h1>
            <div className="w-20" />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="container py-12 focus:outline-none">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">{t("record.choose.heading")}</h2>
              <p className="text-lg text-muted-foreground">{t("record.choose.subtitle")}</p>
            </div>

            <RecordingConsentNotice />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              {/* Record Option */}
              <Card className="p-8 border-2 border-border hover:border-accent/50 transition-all cursor-pointer hover:shadow-lg" onClick={() => setMode("record")}>
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mic className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">{t("record.choose.recordTitle")}</h3>
                    <p className="text-muted-foreground mb-4">{t("record.choose.recordDesc")}</p>
                    <ul className="space-y-2 text-sm text-muted-foreground text-left mb-6">
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.recordFeature1")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.recordFeature2")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.recordFeature3")}
                      </li>
                    </ul>
                  </div>
                  <Button size="lg" className="w-full bg-accent hover:bg-accent/90">
                    {t("record.startRecording")}
                  </Button>
                </div>
              </Card>

              {/* Upload Option */}
              <Card className="p-8 border-2 border-border hover:border-accent/50 transition-all cursor-pointer hover:shadow-lg" onClick={() => setMode("upload")}>
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <UploadCloud className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">{t("record.uploadFile")}</h3>
                    <p className="text-muted-foreground mb-4">{t("record.choose.uploadDesc")}</p>
                    <ul className="space-y-2 text-sm text-muted-foreground text-left mb-6">
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        MP3, WAV, OGG, MP4, MOV, WebM
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.uploadMaxSize", { size: MAX_UPLOAD_LABEL })}
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.uploadDragDrop")}
                      </li>
                    </ul>
                  </div>
                  <Button size="lg" className="w-full bg-accent hover:bg-accent/90">
                    {t("record.uploadFile")}
                  </Button>
                </div>
              </Card>

              {/* Link Option */}
              <Card className="p-8 border-2 border-border hover:border-accent/50 transition-all cursor-pointer hover:shadow-lg" onClick={() => setMode("link")}>
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <LinkIcon className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">{t("record.choose.linkTitle")}</h3>
                    <p className="text-muted-foreground mb-4">{t("record.choose.linkDesc")}</p>
                    <ul className="space-y-2 text-sm text-muted-foreground text-left mb-6">
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.linkFeature1")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.linkFeature2")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        {t("record.choose.linkFeature3", { size: MAX_LINK_IMPORT_LABEL })}
                      </li>
                    </ul>
                  </div>
                  <Button size="lg" className="w-full bg-accent hover:bg-accent/90">
                    {t("record.importLink")}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Recording mode
  if (mode === "record") {
    return (
      <div className={embedded ? "text-foreground" : "min-h-screen bg-background text-foreground"}>
        <header className={`border-b border-border bg-background/95 ${embedded ? "" : "sticky top-0 z-40"}`}>
          <div className="container h-16 flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setMode("choose")}>
              <ArrowLeft className="w-4 h-4" />
              {t("record.back")}
            </Button>
            <h1 className="text-xl font-bold">{t("record.recordLectureTitle")}</h1>
            <div className="w-20" />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="container py-12 focus:outline-none">
          <div className={liveLayout.showHelp ? "mx-auto max-w-6xl" : liveLayout.wide ? "mx-auto max-w-3xl" : "mx-auto max-w-2xl"}>
          {!uploadComplete && <RecordingConsentNotice />}
          <div className={liveLayout.showHelp ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
          <div className="min-w-0 space-y-8">
            {!recordingStopped ? (
              <>
                {/* Recording Controls */}
                <Card className="p-8 border-2 border-border">
                  <div className="space-y-6">
                    {/* Timer */}
                    <div className="text-center">
                      <div className="text-6xl font-bold font-mono text-accent mb-4">
                        {formatTime(duration)}
                      </div>
                      <p className="text-muted-foreground">
                        {isRecording
                          ? recorder.micReconnecting
                            ? t("record.status.micReconnecting")
                            : isPaused ? t("record.status.paused") : t("record.status.recording")
                          : t("record.status.ready")}
                      </p>
                      {isRecording && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("record.keepsRecording")}
                        </p>
                      )}
                    </div>

                    {/* Recording Buttons */}
                    <div className="flex gap-4 justify-center">
                      {!isRecording ? (
                        <Button size="lg" onClick={startRecording} className="gap-2 bg-red-500 hover:bg-red-600">
                          <Mic className="w-5 h-5" />
                          {t("record.startRecording")}
                        </Button>
                      ) : (
                        <>
                          <Button size="lg" onClick={pauseRecording} disabled={isPaused} variant="outline" className="gap-2">
                            <Pause className="w-5 h-5" />
                            {t("record.pause")}
                          </Button>
                          <Button size="lg" onClick={resumeRecording} disabled={!isPaused} variant="outline" className="gap-2">
                            <Play className="w-5 h-5" />
                            {t("record.resume")}
                          </Button>
                          <Button size="lg" onClick={stopRecording} className="gap-2 bg-red-500 hover:bg-red-600">
                            <Square className="w-5 h-5" />
                            {t("record.stop")}
                          </Button>
                        </>
                      )}
                    </div>
                    <MarkMoment />
                    <TabAudioControl />
                    <div className="space-y-5 border-t border-border pt-6">
                      <LiveTextToggle />
                      {!isRecording && <TabAudioOption checked={withTabAudio} onCheckedChange={setWithTabAudio} />}
                    </div>
                  </div>
                </Card>

                {/* Recording Details */}
                <Card className="p-6 border-2 border-border">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">{t("record.titleLabel")}</label>
                      <input
                        type="text"
                        placeholder={t("record.titlePlaceholder")}
                        value={recordingTitle}
                        onChange={(e) => setRecordingTitle(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                      {calendarHint && <p className="mt-1.5 text-xs text-muted-foreground">{calendarHint}</p>}
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">{t("record.contentType")}</label>
                      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="audience"
                            value="student"
                            checked={audience === "student"}
                            onChange={(e) => setAudience(e.target.value as "student" | "professional")}
                            className="w-4 h-4"
                          />
                          <span>{t("record.audience.student")}</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="audience"
                            value="professional"
                            checked={audience === "professional"}
                            onChange={(e) => setAudience(e.target.value as "student" | "professional")}
                            className="w-4 h-4"
                          />
                          <span>{t("record.audience.professional")}</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </Card>
              </>
            ) : (
              <>
                {/* Upload Success */}
                {uploadComplete ? (
                  <Card className="p-8 border-2 border-accent bg-primary/5">
                    <div className="text-center space-y-4">
                      <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                      <h3 className="text-2xl font-bold">{t("record.uploadedTitle")}</h3>
                      <p className="text-muted-foreground">{t("record.uploadedBody")}</p>
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
                    </div>
                  </Card>
                ) : (
                  <Card className="p-8 border-2 border-border">
                    <div className="space-y-6">
                      <div className="text-center">
                        <CheckCircle className="w-12 h-12 text-accent mx-auto mb-4" />
                        <h3 className="text-xl font-bold mb-2">{recorder.recovered ? t("record.recovered") : t("record.complete")}</h3>
                        <p className="text-muted-foreground mb-6">{t("record.duration", { time: formatTime(duration) })}</p>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">{t("record.titleLabel")}</label>
                          <input
                            type="text"
                            placeholder={t("record.titlePlaceholder")}
                            value={recordingTitle}
                            onChange={(e) => setRecordingTitle(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                          {calendarHint && <p className="mt-1.5 text-xs text-muted-foreground">{calendarHint}</p>}
                        </div>

                        <div>
                          <label className="text-sm font-medium mb-2 block">{t("record.contentType")}</label>
                          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="audience"
                                value="student"
                                checked={audience === "student"}
                                onChange={(e) => setAudience(e.target.value as "student" | "professional")}
                                className="w-4 h-4"
                              />
                              <span>{t("record.audience.student")}</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="audience"
                                value="professional"
                                checked={audience === "professional"}
                                onChange={(e) => setAudience(e.target.value as "student" | "professional")}
                                className="w-4 h-4"
                              />
                              <span>{t("record.audience.professional")}</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      <LanguageSelect value={language} onChange={setLanguage} id="record-language" />
                      <CourseSelect value={courseChoice} onChange={setCourseChoice} id="record-course" />
                      <VocabularyField value={vocabulary} onChange={setVocabulary} id="record-vocabulary" />

                      <div className="flex gap-4">
                        <Button
                          size="lg"
                          variant="outline"
                          className="flex-1"
                          onClick={() => recorder.discard()}
                        >
                          {t("record.recordAgain")}
                        </Button>
                        <Button
                          size="lg"
                          className="flex-1 bg-accent hover:bg-accent/90"
                          onClick={submitRecording}
                          disabled={isUploading}
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              {t("record.uploading")}
                            </>
                          ) : (
                            t("record.uploadRecording")
                          )}
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}
            {liveLayout.showTranscript && <LiveTranscriptSection snapshot={liveSnapshot} />}
          </div>
          {liveLayout.showHelp && (
            <div className="lg:sticky lg:top-24">
              <StudyHelpPanel audience={audience} className="lg:max-h-[calc(100vh-8rem)]" />
            </div>
          )}
          </div>
          </div>
        </main>
      </div>
    );
  }

  // Link import mode
  if (mode === "link") {
    return (
      <div className={embedded ? "text-foreground" : "min-h-screen bg-background text-foreground"}>
        <header className={`border-b border-border bg-background/95 ${embedded ? "" : "sticky top-0 z-40"}`}>
          <div className="container h-16 flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setMode("choose")}>
              <ArrowLeft className="w-4 h-4" />
              {t("record.back")}
            </Button>
            <h1 className="text-xl font-bold">{t("record.link.title")}</h1>
            <div className="w-20" />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="container py-12 focus:outline-none">
          <div className="max-w-2xl mx-auto space-y-8">
            {linkComplete ? (
              <Card className="p-8 border-2 border-accent bg-primary/5">
                <div className="text-center space-y-4">
                  <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                  <h3 className="text-2xl font-bold">{t("record.link.doneTitle")}</h3>
                  <p className="text-muted-foreground">{t("record.link.doneBody")}</p>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
                </div>
              </Card>
            ) : (
              <Card className="p-6 border-2 border-border">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">{t("record.link.urlLabel")}</label>
                    <input
                      type="url"
                      placeholder="https://youtube.com/watch?v=… or https://example.com/lecture.mp3"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      disabled={isImporting}
                      className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      {t("record.link.help")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("record.link.limits")}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">{t("record.link.titleLabel")}</label>
                    <input
                      type="text"
                      placeholder={t("record.link.titlePlaceholder")}
                      value={linkTitle}
                      onChange={(e) => setLinkTitle(e.target.value)}
                      disabled={isImporting}
                      className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">{t("record.contentType")}</label>
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                      {(["student", "professional"] as const).map((val) => (
                        <label key={val} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="link-audience"
                            value={val}
                            checked={linkAudience === val}
                            onChange={() => setLinkAudience(val)}
                            disabled={isImporting}
                            className="w-4 h-4"
                          />
                          <span>{val === "student" ? t("record.audience.student") : t("record.audience.professional")}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <LanguageSelect value={language} onChange={setLanguage} id="link-language" />
                  <CourseSelect value={courseChoice} onChange={setCourseChoice} id="link-course" />
                  <VocabularyField value={vocabulary} onChange={setVocabulary} id="link-vocabulary" />

                  <Button
                    size="lg"
                    className="w-full bg-accent hover:bg-accent/90"
                    onClick={handleImportLink}
                    disabled={isImporting || !linkUrl.trim()}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        {t("record.link.fetching")}
                      </>
                    ) : (
                      t("record.link.submit")
                    )}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Upload mode
  if (mode === "upload") {
    return (
      <div className={embedded ? "text-foreground" : "min-h-screen bg-background text-foreground"}>
        <header className={`border-b border-border bg-background/95 ${embedded ? "" : "sticky top-0 z-40"}`}>
          <div className="container h-16 flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setMode("choose")}>
              <ArrowLeft className="w-4 h-4" />
              {t("record.back")}
            </Button>
            <h1 className="text-xl font-bold">{t("record.uploadFile")}</h1>
            <div className="w-20" />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="container py-12 focus:outline-none">
          <div className="max-w-2xl mx-auto space-y-8">
            {uploadFileComplete ? (
              <Card className="p-8 border-2 border-accent bg-primary/5">
                <div className="text-center space-y-4">
                  <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                  <h3 className="text-2xl font-bold">{t("record.upload.doneTitle")}</h3>
                  <p className="text-muted-foreground">{t("record.upload.doneBody")}</p>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
                </div>
              </Card>
            ) : (
              <>
                {/* File Upload Area */}
                <Card
                  className={`p-12 border-2 border-dashed border-border hover:border-accent/50 transition-colors cursor-pointer ${PRESSABLE_FOCUS}`}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  {...pressable(() => fileInputRef.current?.click())}
                >
                  <div className="text-center space-y-4">
                    <UploadCloud className="w-16 h-16 text-muted-foreground mx-auto" />
                    <div>
                      <h3 className="text-xl font-bold mb-2">{t("record.upload.dropTitle")}</h3>
                      <p className="text-muted-foreground mb-2">{t("record.upload.browse")}</p>
                      <p className="text-sm text-muted-foreground">{t("record.upload.formats", { size: MAX_UPLOAD_LABEL })}</p>
                    </div>
                    {selectedFile && (
                      <div className="pt-4 border-t border-border">
                        <div className="flex items-center gap-3 justify-center">
                          <FileAudio className="w-5 h-5 text-accent" />
                          <div className="text-left">
                            <p className="font-medium">{selectedFile.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {t("record.upload.fileSize", { size: formatNumber(selectedFile.size / 1024 / 1024, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,video/quicktime,.mov"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </Card>

                {selectedFile && (
                  <Card className="p-6 border-2 border-border">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">{t("record.upload.titleLabel")}</label>
                        <input
                          type="text"
                          placeholder={t("record.titlePlaceholder")}
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">{t("record.contentType")}</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="upload-audience"
                              value="student"
                              checked={uploadAudience === "student"}
                              onChange={(e) => setUploadAudience(e.target.value as "student" | "professional")}
                              className="w-4 h-4"
                            />
                            <span>{t("record.audience.student")}</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="upload-audience"
                              value="professional"
                              checked={uploadAudience === "professional"}
                              onChange={(e) => setUploadAudience(e.target.value as "student" | "professional")}
                              className="w-4 h-4"
                            />
                            <span>{t("record.audience.professional")}</span>
                          </label>
                        </div>
                      </div>

                      <LanguageSelect value={language} onChange={setLanguage} id="upload-language" />
                      <CourseSelect value={courseChoice} onChange={setCourseChoice} id="upload-course" />
                      <VocabularyField value={vocabulary} onChange={setVocabulary} id="upload-vocabulary" />

                      <div className="flex gap-4">
                        <Button
                          size="lg"
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setSelectedFile(null);
                            setUploadTitle("");
                          }}
                        >
                          {t("record.upload.chooseDifferent")}
                        </Button>
                        <Button
                          size="lg"
                          className="flex-1 bg-accent hover:bg-accent/90"
                          onClick={handleUpload}
                          disabled={isUploadingFile}
                        >
                          {isUploadingFile ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              {uploadPercent > 0 ? t("record.uploadingPercent", { percent: uploadPercent }) : t("record.uploading")}
                            </>
                          ) : (
                            t("record.uploadFile")
                          )}
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    );
  }
}
