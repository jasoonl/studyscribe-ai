import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Trash2, Mic, FileText, MessageSquare, BookOpen, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import Record from "./Record";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [selectedRecordingId, setSelectedRecordingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("recorder");

  // Fetch recordings
  const { data: recordings, isLoading, refetch } = trpc.recordings.list.useQuery();
  const deleteRecordingMutation = trpc.recordings.delete.useMutation();

  const handleDeleteRecording = async (id: number) => {
    if (!confirm("Are you sure you want to delete this recording?")) return;

    try {
      await deleteRecordingMutation.mutateAsync({ id });
      toast.success("Recording deleted");
      refetch();
    } catch (error) {
      toast.error("Failed to delete recording");
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Please sign in to continue</p>
          <Link href="/">
            <Button>Go to Home</Button>
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
          <div className="flex items-center gap-3">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/scribesyncs-logo-myaZdb94CzsaGY5RkidZFa.webp"
              alt="ScribeSync AI"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              ScribeSync AI
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.name || user.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logout()}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Tab Navigation */}
          <TabsList className="grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="recorder" className="gap-2">
              <Mic className="w-4 h-4" />
              <span className="hidden sm:inline">Recorder</span>
            </TabsTrigger>
            <TabsTrigger value="transcription" className="gap-2">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Transcription</span>
            </TabsTrigger>
            <TabsTrigger value="tutor" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">AI Tutor</span>
            </TabsTrigger>
            <TabsTrigger value="summary" className="gap-2">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Summary</span>
            </TabsTrigger>
          </TabsList>

          {/* Recorder Tab */}
          <TabsContent value="recorder" className="space-y-6">
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">Record New Lecture</h2>
              <p className="text-muted-foreground">
                Record a live lecture or meeting directly in your browser
              </p>
            </div>
            <Record />
          </TabsContent>

          {/* Transcription Tab */}
          <TabsContent value="transcription" className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Your Recordings</h2>
                  <p className="text-muted-foreground">
                    View and manage all your recorded lectures and meetings
                  </p>
                </div>
                <Link href="/upload">
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" />
                    Upload File
                  </Button>
                </Link>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
              </div>
            ) : !recordings || recordings.length === 0 ? (
              <Card className="p-12 text-center border-2 border-dashed">
                <Mic className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No recordings yet</h3>
                <p className="text-muted-foreground mb-6">
                  Start by recording a lecture or uploading an audio file
                </p>
                <div className="flex gap-4 justify-center">
                  <Button onClick={() => setActiveTab("recorder")} className="gap-2">
                    <Mic className="w-4 h-4" />
                    Start Recording
                  </Button>
                  <Link href="/upload">
                    <Button variant="outline" className="gap-2">
                      <Plus className="w-4 h-4" />
                      Upload File
                    </Button>
                  </Link>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4">
                {recordings.map((recording) => (
                  <Card
                    key={recording.id}
                    className="p-6 border-2 hover:border-accent/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedRecordingId(recording.id);
                      setActiveTab("summary");
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold mb-2">{recording.title}</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          {new Date(recording.createdAt).toLocaleDateString()} at{" "}
                          {new Date(recording.createdAt).toLocaleTimeString()}
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
                            {recording.audience === "student" ? "Student Lecture" : "Professional Meeting"}
                          </span>
                          {recording.status === "processing" && (
                            <span className="flex items-center gap-2 text-accent">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Processing...
                            </span>
                          )}
                          {recording.status === "completed" && (
                            <span className="text-green-600">✓ Ready</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRecording(recording.id);
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* AI Tutor Tab */}
          <TabsContent value="tutor" className="space-y-6">
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">AI Tutor</h2>
              <p className="text-muted-foreground">
                Select a recording to chat with your AI tutor about the content
              </p>
            </div>

            {!selectedRecordingId ? (
              <Card className="p-12 text-center border-2 border-dashed">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Select a recording</h3>
                <p className="text-muted-foreground mb-6">
                  Choose a recording from the Transcription tab to start chatting with your AI tutor
                </p>
                <Button onClick={() => setActiveTab("transcription")}>
                  Go to Recordings
                </Button>
              </Card>
            ) : (
              <Link href={`/recording/${selectedRecordingId}`}>
                <Button>View Recording Details</Button>
              </Link>
            )}
          </TabsContent>

          {/* Recording Summary Tab */}
          <TabsContent value="summary" className="space-y-6">
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">Recording Summary</h2>
              <p className="text-muted-foreground">
                View AI-generated summaries, flashcards, and study notes
              </p>
            </div>

            {!selectedRecordingId ? (
              <Card className="p-12 text-center border-2 border-dashed">
                <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Select a recording</h3>
                <p className="text-muted-foreground mb-6">
                  Choose a recording from the Transcription tab to view its summary and study materials
                </p>
                <Button onClick={() => setActiveTab("transcription")}>
                  Go to Recordings
                </Button>
              </Card>
            ) : (
              <Link href={`/recording/${selectedRecordingId}`}>
                <Button>View Recording Details</Button>
              </Link>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
