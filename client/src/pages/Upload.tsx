import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, UploadCloud, FileAudio, CheckCircle } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { uploadAudioDirectly } from "@/lib/directAudioUpload";
import { probeAudioDuration } from "@/lib/probeAudioDuration";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@shared/const";
import { PRESSABLE_FOCUS, pressable } from "@/lib/pressable";
import { useI18n } from "@/i18n";

export default function Upload() {
  // ALL hooks must be called unconditionally at the top
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
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
      "audio/x-m4a", "audio/x-wav", "video/mp4", "video/webm", "video/quicktime",
    ];
    // Also accept by extension if MIME type is blank/generic
    const ext = file.name.split(".").pop()?.toLowerCase();
    const validExts = ["mp3", "wav", "ogg", "mp4", "webm", "m4a", "mov"];
    if (!validTypes.includes(file.type) && !validExts.includes(ext || "")) {
      toast.error(t("record.error.invalidFile"));
      return;
    }
    const maxSize = MAX_UPLOAD_BYTES;
    if (file.size > maxSize) {
      toast.error(t("record.error.fileTooLarge", { size: MAX_UPLOAD_LABEL }));
      return;
    }
    setSelectedFile(file);
    setTitle(file.name.replace(/\.[^/.]+$/, ""));
  }, [t]);

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
      reader.onerror = () => reject(new Error(t("record.error.readFile")));
      reader.readAsDataURL(file);
    });

  const handleUpload = async () => {
    if (!selectedFile) { toast.error(t("record.error.noFile")); return; }
    if (!title.trim()) { toast.error(t("record.error.titleRequired")); return; }

    setIsUploading(true);
    setUploadPhase("uploading");
    setUploadProgress(5);

    try {
      const [directUpload, duration] = await Promise.all([
        uploadAudioDirectly(selectedFile, selectedFile.name, setUploadProgress),
        probeAudioDuration(selectedFile),
      ]);
      const base64String = directUpload ? undefined : await readFileAsBase64(selectedFile);
      setUploadProgress(40);

      setUploadPhase("transcribing");
      setUploadProgress(55);

      const recording = await createRecordingMutation.mutateAsync({
        title,
        audience,
        ...(directUpload ? { audioUpload: directUpload } : { audioBase64: base64String! }),
        duration,
      });

      setUploadProgress(80);
      setRecordingId(recording.id);
      setUploadComplete(true);
      setUploadProgress(100);
      toast.success(t("record.toast.fileUploaded"));

      // Fallback redirect after 90 seconds if polling doesn't catch it
      setTimeout(() => {
        navigate(`/recording/${recording.id}`);
      }, 90000);
    } catch (error) {
      console.error("Upload failed:", error);
      const msg = error instanceof Error ? error.message : t("record.error.uploadFileFailed");
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
          <p className="text-muted-foreground mb-4">{t("library.signInFirst")}</p>
          <Link href="/"><Button>{t("library.goHome")}</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t("record.back")}
            </Button>
          </Link>
          <h1 className="text-xl font-bold flex-1 ml-4">{t("record.upload.pageTitle")}</h1>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="container py-12 focus:outline-none">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 border-2 border-border">
            <div className="space-y-6">

              {/* Title Input */}
              <div>
                <label className="block text-sm font-semibold mb-2">{t("record.titleLabel")}</label>
                <input
                  type="text"
                  placeholder={t("record.titlePlaceholder")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isUploading || uploadComplete}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                />
              </div>

              {/* Audience Selection */}
              <div>
                <label className="block text-sm font-semibold mb-2">{t("record.contentType")}</label>
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
                      <span className="text-sm">{val === "student" ? t("record.audience.student") : t("record.audience.professional")}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* File Drop Zone */}
              <div>
                <label className="block text-sm font-semibold mb-3">{t("record.upload.audioFile")}</label>
                {selectedFile ? (
                  <div className="p-4 rounded-lg border-2 border-accent bg-accent/5 flex items-center gap-3">
                    <FileAudio className="w-6 h-6 text-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{t("record.upload.fileSize", { size: (selectedFile.size / (1024 * 1024)).toFixed(2) })}</p>
                    </div>
                    {!isUploading && !uploadComplete && (
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                        {t("record.upload.change")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div
                    {...pressable(() => fileInputRef.current?.click())}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className={`p-8 rounded-lg border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-colors cursor-pointer text-center ${PRESSABLE_FOCUS}`}
                  >
                    <UploadCloud className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium mb-1">{t("record.upload.clickToSelect")}</p>
                    <p className="text-sm text-muted-foreground">{t("record.upload.orDrag")}</p>
                    <p className="text-xs text-muted-foreground mt-2">{t("record.upload.formats", { size: MAX_UPLOAD_LABEL })}</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="audio/*,video/mp4,video/webm,video/quicktime,.mov" onChange={handleFileSelect} className="hidden" disabled={isUploading || uploadComplete} />
              </div>

              {/* Progress Bar — always rendered when uploading or complete */}
              {(isUploading || uploadComplete) && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold">
                      {uploadComplete
                        ? t("record.progress.transcribingAudio")
                        : uploadPhase === "uploading"
                        ? t("record.progress.readingFile")
                        : t("record.progress.uploadingToServer")}
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
                      {t("record.progress.redirectWhenDone")}
                    </p>
                  )}
                </div>
              )}

              {/* Action Area */}
              <div className="flex justify-center">
                {uploadComplete ? (
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                    <p className="text-sm font-medium">{t("record.upload.success")}</p>
                    <p className="text-xs text-muted-foreground">{t("record.upload.waiting")}</p>
                    <Button variant="outline" size="sm" onClick={() => recordingId && navigate(`/recording/${recordingId}`)}>
                      {t("record.goToRecording")}
                    </Button>
                  </div>
                ) : isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    <p className="text-sm text-muted-foreground">{t("record.processing")}</p>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    onClick={handleUpload}
                    disabled={!selectedFile}
                    className="bg-accent hover:bg-accent/90 text-primary gap-2"
                  >
                    <UploadCloud className="w-5 h-5" />
                    {t("record.upload.submit")}
                  </Button>
                )}
              </div>

              {/* Info */}
              <div className="p-4 rounded-lg bg-secondary/50 border border-border text-sm text-muted-foreground">
                {t("record.upload.info")}
              </div>
            </div>
          </Card>

          <Card className="mt-6 p-6 border-2 border-border">
            <h3 className="font-bold mb-3">{t("record.upload.supportedTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("record.upload.supportedList", { size: MAX_UPLOAD_LABEL })}</p>
          </Card>
        </div>
      </main>
    </div>
  );
}
