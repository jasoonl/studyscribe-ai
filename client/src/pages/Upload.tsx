import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, UploadCloud, FileAudio, CheckCircle } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Upload() {
  // ALL hooks must be called unconditionally at the top
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<"student" | "professional">("student");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "transcribing" | "complete">("uploading");
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createRecordingMutation = trpc.recordings.create.useMutation();

  // Poll for transcription status using lightweight getStatus endpoint
  const { data: statusData } = trpc.recordings.getStatus.useQuery(
    { id: recordingId! },
    {
      enabled: uploadComplete && recordingId !== null,
      refetchInterval: uploadComplete && recordingId !== null ? 3000 : false,
    }
  );

  // Auto-redirect when transcription completes
  useEffect(() => {
    if (!uploadComplete || !recordingId || !statusData) return;
    if (statusData.status === "completed" || statusData.status === "failed") {
      navigate(`/recording/${recordingId}`);
    }
  }, [statusData, uploadComplete, recordingId, navigate]);

  const validateAndSetFile = useCallback((file: File) => {
    const validTypes = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
      "audio/ogg", "audio/mp4", "audio/webm", "audio/m4a",
      "audio/x-m4a", "audio/x-wav", "video/mp4", "video/webm",
    ];
    // Also accept by extension if MIME type is blank/generic
    const ext = file.name.split(".").pop()?.toLowerCase();
    const validExts = ["mp3", "wav", "ogg", "mp4", "webm", "m4a"];
    if (!validTypes.includes(file.type) && !validExts.includes(ext || "")) {
      toast.error("Please select a valid audio file (MP3, WAV, OGG, MP4, or WebM)");
      return;
    }
    const maxSize = 16 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error("File size must be less than 16MB");
      return;
    }
    setSelectedFile(file);
    setTitle(file.name.replace(/\.[^/.]+$/, ""));
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const handleUpload = async () => {
    if (!selectedFile) { toast.error("Please select a file"); return; }
    if (!title.trim()) { toast.error("Please enter a title"); return; }

    setIsUploading(true);
    setUploadPhase("uploading");
    setUploadProgress(5);

    try {
      // Simulate progress while reading file
      setUploadProgress(15);
      const base64String = await readFileAsBase64(selectedFile);
      setUploadProgress(40);

      setUploadPhase("transcribing");
      setUploadProgress(55);

      const recording = await createRecordingMutation.mutateAsync({
        title,
        audience,
        audioBase64: base64String,
        duration: 0,
      });

      setUploadProgress(80);
      setRecordingId(recording.id);
      setUploadComplete(true);
      setUploadProgress(100);
      toast.success("File uploaded! Waiting for transcription...");

      // Fallback redirect after 90 seconds if polling doesn't catch it
      setTimeout(() => {
        navigate(`/recording/${recording.id}`);
      }, 90000);
    } catch (error) {
      console.error("Upload failed:", error);
      const msg = error instanceof Error ? error.message : "Failed to upload file";
      toast.error(msg);
      setSelectedFile(null);
      setUploadProgress(0);
      setUploadPhase("uploading");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setIsUploading(false);
    }
  };

  // Auth guards — rendered AFTER all hooks
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
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-xl font-bold flex-1 ml-4">Upload Audio File</h1>
        </div>
      </header>

      <main className="container py-12">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 border-2 border-border">
            <div className="space-y-6">

              {/* Title Input */}
              <div>
                <label className="block text-sm font-semibold mb-2">Recording Title</label>
                <input
                  type="text"
                  placeholder="e.g., Biology 101 - Lecture 5"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isUploading || uploadComplete}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                />
              </div>

              {/* Audience Selection */}
              <div>
                <label className="block text-sm font-semibold mb-2">Recording Type</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  {(["student", "professional"] as const).map((val) => (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value={val}
                        checked={audience === val}
                        onChange={() => setAudience(val)}
                        disabled={isUploading || uploadComplete}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{val === "student" ? "Student Lecture" : "Professional Meeting"}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* File Drop Zone */}
              <div>
                <label className="block text-sm font-semibold mb-3">Audio File</label>
                {selectedFile ? (
                  <div className="p-4 rounded-lg border-2 border-accent bg-accent/5 flex items-center gap-3">
                    <FileAudio className="w-6 h-6 text-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                    {!isUploading && !uploadComplete && (
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                        Change
                      </Button>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className="p-8 rounded-lg border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-colors cursor-pointer text-center"
                  >
                    <UploadCloud className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium mb-1">Click to select file</p>
                    <p className="text-sm text-muted-foreground">or drag and drop an audio file</p>
                    <p className="text-xs text-muted-foreground mt-2">MP3, WAV, OGG, MP4, or WebM • Max 16MB</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="audio/*,video/mp4,video/webm" onChange={handleFileSelect} className="hidden" disabled={isUploading || uploadComplete} />
              </div>

              {/* Progress Bar — always rendered when uploading or complete */}
              {(isUploading || uploadComplete) && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold">
                      {uploadComplete
                        ? "Transcribing your audio..."
                        : uploadPhase === "uploading"
                        ? "Reading file..."
                        : "Uploading to server..."}
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
                      Transcription in progress — you'll be redirected automatically when done.
                    </p>
                  )}
                </div>
              )}

              {/* Action Area */}
              <div className="flex justify-center">
                {uploadComplete ? (
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                    <p className="text-sm font-medium">Uploaded successfully!</p>
                    <p className="text-xs text-muted-foreground">Waiting for transcription to complete...</p>
                    <Button variant="outline" size="sm" onClick={() => recordingId && navigate(`/recording/${recordingId}`)}>
                      Go to Recording Now
                    </Button>
                  </div>
                ) : isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    <p className="text-sm text-muted-foreground">Processing...</p>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    onClick={handleUpload}
                    disabled={!selectedFile}
                    className="bg-accent hover:bg-accent/90 text-primary gap-2"
                  >
                    <UploadCloud className="w-5 h-5" />
                    Upload & Transcribe
                  </Button>
                )}
              </div>

              {/* Info */}
              <div className="p-4 rounded-lg bg-secondary/50 border border-border text-sm text-muted-foreground">
                Your file will be automatically transcribed. This usually takes 1–3 minutes depending on file length.
              </div>
            </div>
          </Card>

          <Card className="mt-6 p-6 border-2 border-border">
            <h3 className="font-bold mb-3">Supported Formats</h3>
            <p className="text-sm text-muted-foreground">MP3, WAV, OGG, M4A, WebM, MP4 — max 16MB</p>
          </Card>
        </div>
      </main>
    </div>
  );
}
