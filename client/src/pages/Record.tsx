import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, Mic, Square, Pause, Play, CheckCircle } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Record() {
  // ALL hooks at the top — no early returns before hooks
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordingTitle, setRecordingTitle] = useState("");
  const [audience, setAudience] = useState<"student" | "professional">("student");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [recordingStopped, setRecordingStopped] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const createRecordingMutation = trpc.recordings.create.useMutation();

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
      navigate(`/recording/${recordingId}`);
    }
  }, [statusData, uploadComplete, recordingId, navigate]);

  // Timer for recording duration
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording, isPaused]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
        else mimeType = "";
      }
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setDuration(0);
      setRecordingStopped(false);
      toast.success("Recording started");
    } catch {
      toast.error("Unable to access microphone. Please check permissions.");
    }
  };

  const pauseRecording = () => {
    mediaRecorderRef.current?.pause();
    setIsPaused(true);
    toast.info("Recording paused");
  };

  const resumeRecording = () => {
    mediaRecorderRef.current?.resume();
    setIsPaused(false);
    toast.info("Recording resumed");
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current.onstop = () => {
      setIsRecording(false);
      setIsPaused(false);
      setRecordingStopped(true);
      toast.info("Recording stopped. Add a title and save.");
    };
  };

  const readBlobAsBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read audio"));
      reader.readAsDataURL(blob);
    });

  const saveRecording = async () => {
    if (!recordingTitle.trim()) { toast.error("Please enter a recording title"); return; }
    if (audioChunksRef.current.length === 0) { toast.error("No audio recorded"); return; }

    setIsUploading(true);
    setUploadProgress(10);
    try {
      const actualMimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
      setUploadProgress(30);
      const base64String = await readBlobAsBase64(audioBlob);
      setUploadProgress(60);

      const recording = await createRecordingMutation.mutateAsync({
        title: recordingTitle,
        audience,
        audioBase64: base64String,
        duration,
      });

      setUploadProgress(100);
      setRecordingId(recording.id);
      setUploadComplete(true);
      toast.success("Recording uploaded! Waiting for transcription...");

      // Fallback redirect after 90s
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to save recording";
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
          <p className="text-muted-foreground mb-4">Please sign in to continue</p>
          <Link href="/"><Button>Go to Home</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
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

      <main className="container py-12">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 border-2 border-border">
            <div className="space-y-8">

              {/* Timer */}
              <div className="text-center space-y-4">
                <div className="text-6xl font-bold font-mono text-accent">{formatTime(duration)}</div>
                {isRecording && (
                  <div className="flex items-center justify-center gap-2">
                    <div className={`w-3 h-3 rounded-full bg-red-500 ${!isPaused ? "animate-pulse" : ""}`} />
                    <span className="text-sm font-medium">{isPaused ? "Paused" : "Recording..."}</span>
                  </div>
                )}
                {recordingStopped && !isRecording && !uploadComplete && (
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium">Recording stopped</span>
                  </div>
                )}
                {/* Waveform */}
                {isRecording && !isPaused && (
                  <div className="flex items-center justify-center gap-1 h-10">
                    {[...Array(16)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-accent rounded-full"
                        style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 50}ms` }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex gap-3 justify-center flex-wrap">
                {!isRecording && !recordingStopped && !uploadComplete && (
                  <Button onClick={startRecording} size="lg" className="gap-2">
                    <Mic className="w-5 h-5" /> Start Recording
                  </Button>
                )}
                {isRecording && (
                  <>
                    <Button onClick={isPaused ? resumeRecording : pauseRecording} variant="outline" size="lg" className="gap-2">
                      {isPaused ? <><Play className="w-5 h-5" /> Resume</> : <><Pause className="w-5 h-5" /> Pause</>}
                    </Button>
                    <Button onClick={stopRecording} variant="destructive" size="lg" className="gap-2">
                      <Square className="w-5 h-5" /> Stop
                    </Button>
                  </>
                )}
              </div>

              {/* Upload Progress */}
              {(isUploading || uploadComplete) && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold">
                      {uploadComplete ? "Transcribing your recording..." : "Uploading..."}
                    </span>
                    <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${uploadComplete ? "bg-green-500 animate-pulse" : "bg-accent"}`}
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
                  <CheckCircle className="w-12 h-12 text-green-500" />
                  <p className="text-sm font-medium">Recording uploaded!</p>
                  <Button variant="outline" size="sm" onClick={() => recordingId && navigate(`/recording/${recordingId}`)}>
                    Go to Recording Now
                  </Button>
                </div>
              )}

              {/* Save Form — shown after recording stops */}
              {recordingStopped && !isRecording && !uploadComplete && (
                <div className="space-y-5 border-t border-border pt-6">
                  <div>
                    <label className="block text-sm font-semibold mb-2">Recording Title *</label>
                    <input
                      type="text"
                      placeholder="e.g., Biology 101 - Lecture 5"
                      value={recordingTitle}
                      onChange={(e) => setRecordingTitle(e.target.value)}
                      disabled={isUploading}
                      className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-2">Recording Type</label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      {(["student", "professional"] as const).map((val) => (
                        <label key={val} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" value={val} checked={audience === val} onChange={() => setAudience(val)} disabled={isUploading} className="w-4 h-4" />
                          <span className="text-sm">{val === "student" ? "Student Lecture" : "Professional Meeting"}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={() => { setRecordingStopped(false); setRecordingTitle(""); setDuration(0); audioChunksRef.current = []; }}
                      disabled={isUploading}
                    >
                      Discard
                    </Button>
                    <Button onClick={saveRecording} disabled={isUploading || !recordingTitle.trim()} className="gap-2">
                      {isUploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save & Transcribe"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
