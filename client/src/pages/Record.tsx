import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, Mic, Square, Pause, Play, CheckCircle, AlertCircle } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function Record() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordingTitle, setRecordingTitle] = useState("");
  const [audience, setAudience] = useState<"student" | "professional">("student");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const createRecordingMutation = trpc.recordings.create.useMutation();

  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, isPaused]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setDuration(0);
      toast.success("Recording started");
    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast.error("Unable to access microphone. Please check permissions.");
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      toast.info("Recording paused");
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      toast.info("Recording resumed");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        setIsRecording(false);
        setIsPaused(false);

        // Upload recording
        if (!recordingTitle.trim()) {
          toast.error("Please enter a recording title");
          return;
        }

        setIsUploading(true);
        try {
          const buffer = Buffer.from(await audioBlob.arrayBuffer());
          const recording = await createRecordingMutation.mutateAsync({
            title: recordingTitle,
            audience,
            audioBuffer: buffer,
            duration,
          });

          setUploadComplete(true);
          toast.success("Recording uploaded! Processing transcript...");

          // Redirect to recording detail after a short delay
          setTimeout(() => {
            window.location.href = `/recording/${recording.id}`;
          }, 1500);
        } catch (error) {
          console.error("Upload failed:", error);
          const errorMessage = error instanceof Error ? error.message : "Failed to upload recording";
          toast.error(errorMessage);
          setIsRecording(false);
          setIsPaused(false);
        } finally {
          setIsUploading(false);
        }
      };
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

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
          <h1 className="text-xl font-bold">Record Lecture</h1>
          <div className="w-20" /> {/* Spacer for alignment */}
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        <div className="max-w-2xl mx-auto">
          {/* Recording Card */}
          <Card className="p-12 border-2 border-border">
            <div className="space-y-8">
              {/* Title Input */}
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Recording Title
                </label>
                <input
                  type="text"
                  placeholder="e.g., Biology 101 - Lecture 5"
                  value={recordingTitle}
                  onChange={(e) => setRecordingTitle(e.target.value)}
                  disabled={isRecording || isUploading}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                />
              </div>

              {/* Audience Selection */}
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Recording Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="student"
                      checked={audience === "student"}
                      onChange={(e) => setAudience(e.target.value as "student" | "professional")}
                      disabled={isRecording || isUploading}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Student Lecture</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="professional"
                      checked={audience === "professional"}
                      onChange={(e) => setAudience(e.target.value as "student" | "professional")}
                      disabled={isRecording || isUploading}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Professional Meeting</span>
                  </label>
                </div>
              </div>

              {/* Recording Status */}
              <div className="text-center space-y-6">
                {/* Timer */}
                <div className="flex justify-center">
                  <div className="text-6xl font-bold font-mono text-accent">
                    {formatTime(duration)}
                  </div>
                </div>

                {/* Status Indicator */}
                {isRecording && (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm font-medium">
                      {isPaused ? "Paused" : "Recording..."}
                    </span>
                  </div>
                )}

                {/* Waveform Visualization */}
                {isRecording && (
                  <div className="flex items-center justify-center gap-1 h-12">
                    {[...Array(20)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-gradient-to-t from-primary to-accent rounded-full"
                        style={{
                          height: `${Math.random() * 100}%`,
                          animation: `pulse ${0.5 + Math.random() * 0.5}s ease-in-out infinite`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex gap-4 justify-center">
                {uploadComplete ? (
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                    <p className="text-sm text-muted-foreground">Recording uploaded successfully!</p>
                    <p className="text-xs text-muted-foreground">Redirecting...</p>
                  </div>
                ) : isUploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    <p className="text-sm text-muted-foreground">Uploading recording...</p>
                  </div>
                ) : !isRecording ? (
                  <Button
                    size="lg"
                    onClick={startRecording}
                    className="bg-red-500 hover:bg-red-600 text-white gap-2"
                  >
                    <Mic className="w-5 h-5" />
                    Start Recording
                  </Button>
                ) : (
                  <>
                    {!isPaused ? (
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={pauseRecording}
                        className="gap-2"
                      >
                        <Pause className="w-5 h-5" />
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={resumeRecording}
                        className="gap-2"
                      >
                        <Play className="w-5 h-5" />
                        Resume
                      </Button>
                    )}
                    <Button
                      size="lg"
                      onClick={stopRecording}
                      className="bg-red-500 hover:bg-red-600 text-white gap-2"
                    >
                      <Square className="w-5 h-5" />
                      Stop Recording
                    </Button>
                  </>
                )}
              </div>

              {/* Info */}
              <div className="p-4 rounded-lg bg-secondary/50 border border-border text-sm text-muted-foreground">
                <p>
                  Your recording will be automatically transcribed and processed with AI-powered study tools once you stop recording. This may take a few minutes depending on the recording length.
                </p>
              </div>
            </div>
          </Card>

          {/* Tips */}
          <Card className="mt-8 p-6 border-2 border-border">
            <h3 className="font-bold mb-4">Recording Tips</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• Use a quiet environment for better transcription accuracy</li>
              <li>• Speak clearly and at a moderate pace</li>
              <li>• Avoid background noise and interruptions</li>
              <li>• Keep your microphone at a consistent distance</li>
            </ul>
          </Card>
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
