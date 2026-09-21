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

type Mode = "choose" | "record" | "upload" | "link";

export default function RecordOrUpload() {
  const { user } = useCustomAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("choose");

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordingTitle, setRecordingTitle] = useState("");
  const [audience, setAudience] = useState<"student" | "professional">("student");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [recordingStopped, setRecordingStopped] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadAudience, setUploadAudience] = useState<"student" | "professional">("student");
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadFileComplete, setUploadFileComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Link import state
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkAudience, setLinkAudience] = useState<"student" | "professional">("student");
  const [isImporting, setIsImporting] = useState(false);
  const [linkComplete, setLinkComplete] = useState(false);

  const [createdRecordingId, setCreatedRecordingId] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const createRecordingMutation = trpc.recordings.create.useMutation();
  const createFromUrlMutation = trpc.recordings.createFromUrl.useMutation();

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
      navigate(`/recording/${createdRecordingId}`);
    }
  }, [statusData, isPolling, createdRecordingId, navigate]);

  // Recording timer
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

  // Recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/wav')) {
          mimeType = 'audio/wav';
        } else {
          mimeType = '';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStopped(false);
      setDuration(0);
      toast.success("Recording started");
    } catch (error) {
      toast.error("Failed to start recording. Please check microphone permissions.");
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setIsPaused(false);
      setRecordingStopped(true);
    }
  };

  // Helper: read blob/file as base64 DataURL using a Promise (avoids async callback bug)
  const readAsBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read audio"));
      reader.readAsDataURL(blob);
    });
  };

  const submitRecording = async () => {
    if (!recordingTitle.trim()) {
      toast.error("Please enter a title");
      return;
    }

    if (audioChunksRef.current.length === 0) {
      toast.error("No audio recorded");
      return;
    }

    setIsUploading(true);
    try {
      const actualMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
      const directUpload = await uploadAudioDirectly(audioBlob, `recording-${Date.now()}.webm`);
      const base64String = directUpload ? undefined : await readAsBase64(audioBlob);
      const recording = await createRecordingMutation.mutateAsync({
        title: recordingTitle,
        audience,
        ...(directUpload ? { audioUpload: directUpload } : { audioBase64: base64String! }),
        duration,
      });
      setUploadComplete(true);
      setCreatedRecordingId(recording.id);
      setIsPolling(true);
      toast.success("Recording uploaded! Waiting for transcription...");
      // Fallback redirect after 90 seconds
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      console.error("Failed to upload recording:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload recording";
      toast.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  // Upload functions
  const validateAndSetFile = (file: File) => {
    const validTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg", "audio/mp4", "audio/webm", "audio/m4a", "audio/x-m4a"];
    if (!validTypes.includes(file.type)) {
      toast.error("Please select a valid audio file (MP3, WAV, OGG, MP4, or WebM)");
      return;
    }

    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error("File size must be less than 500MB");
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
      toast.error("Please select a file");
      return;
    }

    if (!uploadTitle.trim()) {
      toast.error("Please enter a title");
      return;
    }

    setIsUploadingFile(true);
    try {
      const [directUpload, duration] = await Promise.all([
        uploadAudioDirectly(selectedFile, selectedFile.name),
        probeAudioDuration(selectedFile),
      ]);
      const base64String = directUpload ? undefined : await readAsBase64(selectedFile);
      const recording = await createRecordingMutation.mutateAsync({
        title: uploadTitle,
        audience: uploadAudience,
        ...(directUpload ? { audioUpload: directUpload } : { audioBase64: base64String! }),
        duration,
      });
      setUploadFileComplete(true);
      setCreatedRecordingId(recording.id);
      setIsPolling(true);
      toast.success("File uploaded! Waiting for transcription...");
      // Fallback redirect after 90 seconds
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      console.error("Failed to upload file:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload file";
      toast.error(errorMessage);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleImportLink = async () => {
    if (!linkUrl.trim()) {
      toast.error("Paste a link to an audio file");
      return;
    }

    setIsImporting(true);
    try {
      const recording = await createFromUrlMutation.mutateAsync({
        url: linkUrl.trim(),
        title: linkTitle.trim() || undefined,
        audience: linkAudience,
      });
      setLinkComplete(true);
      setCreatedRecordingId(recording.id);
      setIsPolling(true);
      toast.success("Audio imported! Waiting for transcription...");
      setTimeout(() => navigate(`/recording/${recording.id}`), 90000);
    } catch (error) {
      console.error("Failed to import link:", error);
      toast.error(error instanceof Error ? error.message : "Failed to import that link");
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
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
          <div className="container h-16 flex items-center justify-between">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Add Recording or Lecture</h1>
            <div className="w-20" />
          </div>
        </header>

        <main className="container py-12">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">How would you like to add content?</h2>
              <p className="text-lg text-muted-foreground">Choose to record a live lecture or upload an existing audio file</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              {/* Record Option */}
              <Card className="p-8 border-2 border-border hover:border-accent/50 transition-all cursor-pointer hover:shadow-lg" onClick={() => setMode("record")}>
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <Mic className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Record Live</h3>
                    <p className="text-muted-foreground mb-4">Record a lecture, meeting, or presentation directly from your browser</p>
                    <ul className="space-y-2 text-sm text-muted-foreground text-left mb-6">
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Real-time recording
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Pause and resume
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Automatic transcription
                      </li>
                    </ul>
                  </div>
                  <Button size="lg" className="w-full bg-accent hover:bg-accent/90">
                    Start Recording
                  </Button>
                </div>
              </Card>

              {/* Upload Option */}
              <Card className="p-8 border-2 border-border hover:border-accent/50 transition-all cursor-pointer hover:shadow-lg" onClick={() => setMode("upload")}>
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <UploadCloud className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Upload File</h3>
                    <p className="text-muted-foreground mb-4">Upload an existing audio or video file from your device</p>
                    <ul className="space-y-2 text-sm text-muted-foreground text-left mb-6">
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        MP3, WAV, OGG, MP4, WebM
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Up to 500MB file size
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Drag and drop support
                      </li>
                    </ul>
                  </div>
                  <Button size="lg" className="w-full bg-accent hover:bg-accent/90">
                    Upload File
                  </Button>
                </div>
              </Card>

              {/* Link Option */}
              <Card className="p-8 border-2 border-border hover:border-accent/50 transition-all cursor-pointer hover:shadow-lg" onClick={() => setMode("link")}>
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <LinkIcon className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">From a Link</h3>
                    <p className="text-muted-foreground mb-4">Paste a link to a talk or lecture recording and we'll fetch and transcribe it</p>
                    <ul className="space-y-2 text-sm text-muted-foreground text-left mb-6">
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        No download needed
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Audio or video files
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        Up to 200MB
                      </li>
                    </ul>
                  </div>
                  <Button size="lg" className="w-full bg-accent hover:bg-accent/90">
                    Import Link
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
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
          <div className="container h-16 flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setMode("choose")}>
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <h1 className="text-xl font-bold">Record Lecture</h1>
            <div className="w-20" />
          </div>
        </header>

        <main className="container py-12">
          <div className="max-w-2xl mx-auto space-y-8">
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
                        {isRecording ? (isPaused ? "Paused" : "Recording...") : "Ready to record"}
                      </p>
                    </div>

                    {/* Recording Buttons */}
                    <div className="flex gap-4 justify-center">
                      {!isRecording ? (
                        <Button size="lg" onClick={startRecording} className="gap-2 bg-red-500 hover:bg-red-600">
                          <Mic className="w-5 h-5" />
                          Start Recording
                        </Button>
                      ) : (
                        <>
                          <Button size="lg" onClick={pauseRecording} disabled={isPaused} variant="outline" className="gap-2">
                            <Pause className="w-5 h-5" />
                            Pause
                          </Button>
                          <Button size="lg" onClick={resumeRecording} disabled={!isPaused} variant="outline" className="gap-2">
                            <Play className="w-5 h-5" />
                            Resume
                          </Button>
                          <Button size="lg" onClick={stopRecording} className="gap-2 bg-red-500 hover:bg-red-600">
                            <Square className="w-5 h-5" />
                            Stop
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Recording Details */}
                <Card className="p-6 border-2 border-border">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Recording Title *</label>
                      <input
                        type="text"
                        placeholder="e.g., Physics 101 - Lecture 5"
                        value={recordingTitle}
                        onChange={(e) => setRecordingTitle(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">Content Type</label>
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
                          <span>Student Lecture</span>
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
                          <span>Professional Meeting</span>
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
                  <Card className="p-8 border-2 border-accent bg-gradient-to-br from-accent/5 to-primary/5">
                    <div className="text-center space-y-4">
                      <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                      <h3 className="text-2xl font-bold">Recording uploaded successfully!</h3>
                      <p className="text-muted-foreground">Your recording is being transcribed. You'll be redirected to your dashboard shortly.</p>
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
                    </div>
                  </Card>
                ) : (
                  <Card className="p-8 border-2 border-border">
                    <div className="space-y-6">
                      <div className="text-center">
                        <CheckCircle className="w-12 h-12 text-accent mx-auto mb-4" />
                        <h3 className="text-xl font-bold mb-2">Recording Complete</h3>
                        <p className="text-muted-foreground mb-6">Duration: {formatTime(duration)}</p>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Recording Title *</label>
                          <input
                            type="text"
                            placeholder="e.g., Physics 101 - Lecture 5"
                            value={recordingTitle}
                            onChange={(e) => setRecordingTitle(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                        </div>

                        <div>
                          <label className="text-sm font-medium mb-2 block">Content Type</label>
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
                              <span>Student Lecture</span>
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
                              <span>Professional Meeting</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <Button
                          size="lg"
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setRecordingStopped(false);
                            setDuration(0);
                            audioChunksRef.current = [];
                          }}
                        >
                          Record Again
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
                              Uploading...
                            </>
                          ) : (
                            "Upload Recording"
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

  // Link import mode
  if (mode === "link") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
          <div className="container h-16 flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setMode("choose")}>
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <h1 className="text-xl font-bold">Import from Link</h1>
            <div className="w-20" />
          </div>
        </header>

        <main className="container py-12">
          <div className="max-w-2xl mx-auto space-y-8">
            {linkComplete ? (
              <Card className="p-8 border-2 border-accent bg-gradient-to-br from-accent/5 to-primary/5">
                <div className="text-center space-y-4">
                  <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                  <h3 className="text-2xl font-bold">Audio imported successfully!</h3>
                  <p className="text-muted-foreground">It's being transcribed now. You'll be redirected shortly.</p>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
                </div>
              </Card>
            ) : (
              <Card className="p-6 border-2 border-border">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Audio Link *</label>
                    <input
                      type="url"
                      placeholder="https://example.com/lecture.mp3"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      disabled={isImporting}
                      className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      A direct link to an audio or video file (MP3, M4A, WAV, OGG, MP4, MOV, WebM) on a public website.
                      The audio track of a video is transcribed automatically.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Streaming pages such as YouTube links are not supported — their terms prohibit downloading the
                      media. Use a direct file link, or a platform that offers one.
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Title (optional)</label>
                    <input
                      type="text"
                      placeholder="Defaults to the file name"
                      value={linkTitle}
                      onChange={(e) => setLinkTitle(e.target.value)}
                      disabled={isImporting}
                      className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Content Type</label>
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
                          <span>{val === "student" ? "Student Lecture" : "Professional Meeting"}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <Button
                    size="lg"
                    className="w-full bg-accent hover:bg-accent/90"
                    onClick={handleImportLink}
                    disabled={isImporting || !linkUrl.trim()}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Fetching audio...
                      </>
                    ) : (
                      "Import & Transcribe"
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
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
          <div className="container h-16 flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setMode("choose")}>
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <h1 className="text-xl font-bold">Upload File</h1>
            <div className="w-20" />
          </div>
        </header>

        <main className="container py-12">
          <div className="max-w-2xl mx-auto space-y-8">
            {uploadFileComplete ? (
              <Card className="p-8 border-2 border-accent bg-gradient-to-br from-accent/5 to-primary/5">
                <div className="text-center space-y-4">
                  <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                  <h3 className="text-2xl font-bold">File uploaded successfully!</h3>
                  <p className="text-muted-foreground">Your file is being transcribed. You'll be redirected to your dashboard shortly.</p>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
                </div>
              </Card>
            ) : (
              <>
                {/* File Upload Area */}
                <Card
                  className="p-12 border-2 border-dashed border-border hover:border-accent/50 transition-colors cursor-pointer"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-center space-y-4">
                    <UploadCloud className="w-16 h-16 text-muted-foreground mx-auto" />
                    <div>
                      <h3 className="text-xl font-bold mb-2">Drag and drop your file here</h3>
                      <p className="text-muted-foreground mb-2">or click to browse</p>
                      <p className="text-sm text-muted-foreground">Supported formats: MP3, WAV, OGG, MP4, WebM (Max 500MB)</p>
                    </div>
                    {selectedFile && (
                      <div className="pt-4 border-t border-border">
                        <div className="flex items-center gap-3 justify-center">
                          <FileAudio className="w-5 h-5 text-accent" />
                          <div className="text-left">
                            <p className="font-medium">{selectedFile.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </Card>

                {selectedFile && (
                  <Card className="p-6 border-2 border-border">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">File Title *</label>
                        <input
                          type="text"
                          placeholder="e.g., Physics 101 - Lecture 5"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Content Type</label>
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
                            <span>Student Lecture</span>
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
                            <span>Professional Meeting</span>
                          </label>
                        </div>
                      </div>

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
                          Choose Different File
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
                              Uploading...
                            </>
                          ) : (
                            "Upload File"
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
