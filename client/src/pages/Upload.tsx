import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, UploadCloud, FileAudio, CheckCircle } from "lucide-react";
import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Upload() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<"student" | "professional">("student");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createRecordingMutation = trpc.recordings.create.useMutation();

  const validateAndSetFile = (file: File) => {
    // Validate file type
    const validTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm"];
    if (!validTypes.includes(file.type)) {
      toast.error("Please select a valid audio file (MP3, WAV, OGG, MP4, or WebM)");
      return;
    }

    // Validate file size (16MB limit)
    const maxSize = 16 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error("File size must be less than 16MB");
      return;
    }

    setSelectedFile(file);
    setTitle(file.name.replace(/\.[^/.]+$/, ""));
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

    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    setIsUploading(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64String = reader.result as string;
        const recording = await createRecordingMutation.mutateAsync({
          title,
          audience,
          audioBase64: base64String,
          duration: 0,
        });

        setUploadComplete(true);
        toast.success("File uploaded! Processing transcript...");

        // Redirect to recording detail after a short delay
        setTimeout(() => {
          navigate(`/recording/${recording.id}`);
        }, 1500);
      };
      reader.onerror = () => {
        throw new Error("Failed to read file");
      };
      reader.readAsDataURL(selectedFile);
      return;
    } catch (error) {
      console.error("Upload failed:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload file";
      toast.error(errorMessage);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setIsUploading(false);
    }
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
          <h1 className="text-xl font-bold flex-1 ml-4">Upload Audio File</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        <div className="max-w-2xl mx-auto">
          {/* Upload Card */}
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
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isUploading}
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
                      disabled={isUploading}
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
                      disabled={isUploading}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Professional Meeting</span>
                  </label>
                </div>
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-semibold mb-4">
                  Audio File
                </label>

                {selectedFile ? (
                  <div className="p-4 rounded-lg border-2 border-accent bg-accent/5 flex items-center gap-3">
                    <FileAudio className="w-6 h-6 text-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      disabled={isUploading}
                    >
                      Change
                    </Button>
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
                    <p className="text-sm text-muted-foreground">
                      or drag and drop an audio file
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      MP3, WAV, OGG, MP4, or WebM • Max 16MB
                    </p>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isUploading}
                />
              </div>

              {/* Upload Button */}
              <div className="flex gap-4 justify-center">
                {uploadComplete ? (
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                    <p className="text-sm text-muted-foreground">File uploaded successfully!</p>
                    <p className="text-xs text-muted-foreground">Redirecting...</p>
                  </div>
                ) : isUploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    <p className="text-sm text-muted-foreground">Uploading file...</p>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    onClick={handleUpload}
                    disabled={!selectedFile}
                    className="bg-accent hover:bg-accent/90 text-primary gap-2"
                  >
                    <UploadCloud className="w-5 h-5" />
                    Upload File
                  </Button>
                )}
              </div>

              {/* Info */}
              <div className="p-4 rounded-lg bg-secondary/50 border border-border text-sm text-muted-foreground">
                <p>
                  Your file will be automatically transcribed and processed with AI-powered study tools. This may take a few minutes depending on the file size.
                </p>
              </div>
            </div>
          </Card>

          {/* Supported Formats */}
          <Card className="mt-8 p-6 border-2 border-border">
            <h3 className="font-bold mb-4">Supported Formats</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• MP3 (.mp3)</li>
              <li>• WAV (.wav)</li>
              <li>• OGG (.ogg)</li>
              <li>• MP4 Audio (.m4a)</li>
              <li>• WebM (.webm)</li>
            </ul>
          </Card>
        </div>
      </main>
    </div>
  );
}
