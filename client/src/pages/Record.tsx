import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ArrowLeft,
  Mic,
  Square,
  Pause,
  Play,
  CheckCircle,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { uploadAudioDirectly } from "@/lib/directAudioUpload";
import { useRecorder, useShowsRecorder } from "@/contexts/RecorderContext";
import { useCalendarTitle } from "@/components/CalendarReminderWatcher";
import { useLiveTranscript } from "@/contexts/LiveTranscriptContext";
import { formatClockTime } from "@/lib/recordingClock";
import type { LiveTurn } from "@/lib/liveTurns";
import { cn } from "@/lib/utils";
import { MarkMoment } from "@/components/MarkMoment";
import RecordingConsentNotice from "@/components/RecordingConsentNotice";
import {
  LiveTextToggle,
  TabAudioControl,
  TabAudioOption,
} from "@/components/live/RecordingOptions";
import {
  LiveTranscriptSection,
  useLiveLayout,
} from "@/components/live/LiveTranscriptSection";
import { StudyHelpPanel } from "@/components/live/StudyHelpPanel";

export default function Record() {
  // ALL hooks at the top — no early returns before hooks
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  // Recording state lives in RecorderProvider so it survives leaving this page.
  const recorder = useRecorder();
  const live = useLiveTranscript();
  useShowsRecorder(true);
  const isRecording =
    recorder.status === "recording" || recorder.status === "paused";
  const isPaused = recorder.status === "paused";
  const duration = recorder.elapsedSeconds;
  const [recordingTitle, setRecordingTitle] = useState("");
  const calendarHint = useCalendarTitle(recorder, recordingTitle, setRecordingTitle);
  const [audience, setAudience] = useState<"student" | "professional">(
    "student"
  );
  const [withTabAudio, setWithTabAudio] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const recordingStopped = recorder.status === "stopped";
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordingId, setRecordingId] = useState<number | null>(null);
  // Live text kept on screen after upload, until the real transcript replaces it.
  const [liveSnapshot, setLiveSnapshot] = useState<LiveTurn[] | null>(null);
  const createRecordingMutation = trpc.recordings.create.useMutation();
  const layout = useLiveLayout(liveSnapshot);

  // Poll for transcription status using lightweight getStatus endpoint
  const { data: statusData } = trpc.recordings.getStatus.useQuery(
    { id: recordingId! },
    {
      enabled: uploadComplete && recordingId !== null,
      refetchInterval: uploadComplete && recordingId !== null ? 3000 : false,
    }
  );

  // Auto-redirect when transcription completes or fails
  useEffect(() => {
    if (!uploadComplete || !recordingId || !statusData) return;
    if (statusData.status === "completed" || statusData.status === "failed") {
      setLiveSnapshot(null);
      navigate(`/recording/${recordingId}`);
    }
  }, [statusData, uploadComplete, recordingId, navigate]);

  // Offer back a recording that a crash, reload or closed tab interrupted.
  const { restoreUnsaved } = recorder;
  useEffect(() => {
    if (user) void restoreUnsaved(user.id);
  }, [user, restoreUnsaved]);

  const startRecording = async () => {
    const started = await recorder.start({
      userId: user?.id ?? null,
      returnPath: "/record",
      tabAudio: withTabAudio,
    });
    if (started)
      toast.success(
        "Recording started. It keeps going if you switch tabs or windows."
      );
  };

  const pauseRecording = () => {
    recorder.pause();
    toast.info("Recording paused");
  };

  const resumeRecording = () => {
    recorder.resume();
    toast.info("Recording resumed");
  };

  const stopRecording = async () => {
    await recorder.stop();
    toast.info("Recording stopped. Add a title and save.");
  };

  const readBlobAsBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read audio"));
      reader.readAsDataURL(blob);
    });

  const saveRecording = async () => {
    if (!recordingTitle.trim()) {
      toast.error("Please enter a recording title");
      return;
    }
    const finished = recorder.getRecording();
    if (!finished) {
      toast.error("No audio recorded");
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    try {
      const {
        blob: audioBlob,
        mimeType: actualMimeType,
        durationSeconds,
        bookmarks,
      } = finished;
      const fileName = `recording-${Date.now()}.${actualMimeType.startsWith("audio/mp4") ? "mp4" : "webm"}`;
      const directUpload = await uploadAudioDirectly(
        audioBlob,
        fileName,
        setUploadProgress
      );
      const base64String = directUpload
        ? undefined
        : await readBlobAsBase64(audioBlob);
      setUploadProgress(60);

      const recording = await createRecordingMutation.mutateAsync({
        title: recordingTitle,
        audience,
        ...(directUpload
          ? { audioUpload: directUpload }
          : { audioBase64: base64String! }),
        duration: durationSeconds,
        bookmarks: bookmarks.map(atSeconds => ({ atSeconds })),
      });

      setUploadProgress(100);
      setRecordingId(recording.id);
      setUploadComplete(true);
      if (live.turns.length > 0) setLiveSnapshot(live.turns);
      recorder.discard();
      toast.success("Recording uploaded! Waiting for transcription...");

      // Fallback redirect after 90s
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to save recording";
      toast.error(msg);
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  // Auth guards — AFTER all hooks
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">
            Please sign in to continue
          </p>
          <Link href="/">
            <Button>Go to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const ready = !isRecording && !recordingStopped && !uploadComplete;

  const recorderCard = (
    <Card className="gap-0 p-6 sm:p-8">
      <div className="space-y-8">
        {/* Timer */}
        <div className="text-center space-y-3">
          <div className="text-6xl font-bold font-mono tabular-nums text-accent">
            {formatClockTime(duration)}
          </div>
          {isRecording && (
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2.5 rounded-full bg-destructive",
                    !isPaused && "motion-safe:animate-pulse"
                  )}
                />
                <span className="text-sm font-medium">
                  {recorder.micReconnecting
                    ? "Microphone disconnected, reconnecting..."
                    : isPaused
                      ? "Paused"
                      : "Recording..."}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Keeps recording when you switch tabs, windows or pages, until
                you press Stop. Keep this tab open.
              </p>
            </div>
          )}
          {recordingStopped && !isRecording && !uploadComplete && (
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">
                {recorder.recovered
                  ? "Recovered unsaved recording"
                  : "Recording stopped"}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className={cn("flex gap-3 justify-center flex-wrap", !ready && !isRecording && "hidden")}>
          {ready && (
            <Button onClick={startRecording} size="lg" className="gap-2">
              <Mic className="w-5 h-5" /> Start Recording
            </Button>
          )}
          {isRecording && (
            <>
              <Button
                onClick={isPaused ? resumeRecording : pauseRecording}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                {isPaused ? (
                  <>
                    <Play className="w-5 h-5" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-5 h-5" /> Pause
                  </>
                )}
              </Button>
              <Button
                onClick={stopRecording}
                variant="destructive"
                size="lg"
                className="gap-2"
              >
                <Square className="w-5 h-5" /> Stop
              </Button>
            </>
          )}
        </div>
        {!uploadComplete && <MarkMoment />}
        <TabAudioControl />

        {/* Options before starting */}
        {ready && (
          <div className="space-y-5 border-t border-border pt-6">
            <LiveTextToggle />
            <TabAudioOption
              checked={withTabAudio}
              onCheckedChange={setWithTabAudio}
            />
          </div>
        )}
        {isRecording && (
          <div className="border-t border-border pt-6">
            <LiveTextToggle />
          </div>
        )}

        {/* Upload Progress */}
        {(isUploading || uploadComplete) && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold">
                {uploadComplete
                  ? "Transcribing your recording..."
                  : "Uploading..."}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {uploadProgress}%
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500 motion-reduce:transition-none",
                  uploadComplete
                    ? "bg-primary motion-safe:animate-pulse"
                    : "bg-accent"
                )}
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            {uploadComplete && (
              <p className="text-xs text-muted-foreground text-center">
                You'll be redirected automatically when transcription completes.
              </p>
            )}
          </div>
        )}

        {/* Upload Complete */}
        {uploadComplete && (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle className="w-12 h-12 text-primary" />
            <p className="text-sm font-medium">Recording uploaded!</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                recordingId && navigate(`/recording/${recordingId}`)
              }
            >
              Go to Recording Now
            </Button>
          </div>
        )}

        {/* Save Form — shown after recording stops */}
        {recordingStopped && !isRecording && !uploadComplete && (
          <div className="space-y-5 border-t border-border pt-6">
            <div>
              <label
                htmlFor="record-title"
                className="block text-sm font-semibold mb-2"
              >
                Recording Title *
              </label>
              <Input
                id="record-title"
                placeholder="e.g., Biology 101 - Lecture 5"
                value={recordingTitle}
                onChange={e => setRecordingTitle(e.target.value)}
                disabled={isUploading}
              />
              {calendarHint && <p className="mt-1.5 text-xs text-muted-foreground">{calendarHint}</p>}
            </div>

            <fieldset>
              <legend className="block text-sm font-semibold mb-2">
                Recording Type
              </legend>
              <div className="flex flex-col sm:flex-row gap-3">
                {(["student", "professional"] as const).map(val => (
                  <label
                    key={val}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      value={val}
                      checked={audience === val}
                      onChange={() => setAudience(val)}
                      disabled={isUploading}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm">
                      {val === "student"
                        ? "Student Lecture"
                        : "Professional Meeting"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-3 justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  recorder.discard();
                  setRecordingTitle("");
                }}
                disabled={isUploading}
              >
                Discard
              </Button>
              <Button
                onClick={saveRecording}
                disabled={isUploading || !recordingTitle.trim()}
                className="gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : (
                  "Save & Transcribe"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Record Lecture</h1>
          <div className="w-20" />
        </div>
      </header>

      <main className="container py-8 sm:py-12">
        {layout.wide ? (
          <div className={cn("mx-auto", layout.showHelp ? "max-w-6xl" : "max-w-3xl")}>
            {!uploadComplete && <RecordingConsentNotice />}
            <div className={cn("grid items-start gap-6", layout.showHelp && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
              <div className="min-w-0 space-y-6">
                {recorderCard}
                {layout.showTranscript && (
                  <LiveTranscriptSection snapshot={liveSnapshot} />
                )}
              </div>
              {layout.showHelp && (
                <div className="lg:sticky lg:top-24">
                  <StudyHelpPanel
                    audience={audience}
                    className="lg:max-h-[calc(100vh-8rem)]"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {!uploadComplete && <RecordingConsentNotice />}
            {recorderCard}
          </div>
        )}
      </main>
    </div>
  );
}
