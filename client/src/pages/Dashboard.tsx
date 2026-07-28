import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, Mic, FileText, MessageSquare, BookOpen, Plus, Search, Filter, Calendar, Clock, TrendingUp, Database } from "lucide-react";
import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import RecordOrUpload from "./RecordOrUpload";
import { useAuth } from "@/_core/hooks/useAuth";
import { OnboardingModal } from "@/components/OnboardingModal";

function TrashTabContent() {
  const { data: deletedRecordings, isLoading } = trpc.recordings.listDeleted.useQuery();
  const restoreMutation = trpc.recordings.restore.useMutation();
  const permanentDeleteMutation = trpc.recordings.permanentDelete.useMutation();
  const utils = trpc.useUtils();

  const handleRestore = async (id: number) => {
    try {
      await restoreMutation.mutateAsync({ id });
      toast.success("Recording restored");
      // Invalidate both deleted and active recordings lists
      await utils.recordings.listDeleted.invalidate();
      await utils.recordings.list.invalidate();
    } catch (error) {
      toast.error("Failed to restore recording");
    }
  };

  const handlePermanentDelete = async (id: number, title: string) => {
    if (!confirm(`Are you sure you want to permanently delete "${title}"? This cannot be undone.`)) {
      return;
    }
    try {
      await permanentDeleteMutation.mutateAsync({ id });
      toast.success("Recording permanently deleted");
      // Invalidate deleted recordings list
      await utils.recordings.listDeleted.invalidate();
    } catch (error) {
      toast.error("Failed to permanently delete recording");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!deletedRecordings || deletedRecordings.length === 0) {
    return (
      <Card className="p-12 text-center">
        <Trash2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">No deleted recordings</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {deletedRecordings.map((recording) => (
        <Card key={recording.id} className="p-4 flex items-start justify-between">
          <div>
            <h4 className="font-semibold">{recording.title}</h4>
            <p className="text-sm text-muted-foreground">Deleted {recording.deletedAt ? new Date(recording.deletedAt).toLocaleDateString() : "recently"}</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleRestore(recording.id)}
              disabled={restoreMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handlePermanentDelete(recording.id, recording.title)}
              disabled={permanentDeleteMutation.isPending}
            >
              Delete Forever
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user, logout, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "student" | "professional">("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "name">("recent");

  // Fetch recordings
  const { data: recordings, isLoading, refetch } = trpc.recordings.list.useQuery();
  const deleteRecordingMutation = trpc.recordings.delete.useMutation();

  // Calculate statistics
  const statistics = useMemo(() => {
    const totalSeconds = (recordings || []).reduce((sum, r) => sum + (r.duration || 0), 0);
    const totalHours = (totalSeconds / 3600).toFixed(1);
    const totalRecordings = recordings?.length || 0;

    return {
      totalHours,
      totalRecordings,
    };
  }, [recordings]);

  // Filter and search recordings
  const filteredRecordings = useMemo(() => {
    if (!recordings) return [];

    let filtered = recordings;

    // Filter by audience
    if (filterType !== "all") {
      filtered = filtered.filter(r => r.audience === filterType);
    }

    // Search by title
    if (searchQuery) {
      filtered = filtered.filter(r =>
        r.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort
    if (sortBy === "recent") {
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "oldest") {
      filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortBy === "name") {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    }

    return filtered;
  }, [recordings, searchQuery, filterType, sortBy]);

  const handleDeleteRecording = async (id: number) => {
    if (!confirm("Are you sure you want to delete this recording?")) return;

    try {
      await deleteRecordingMutation.mutateAsync({ id });
      toast.success("Recording deleted");
      // Use proper cache invalidation
      const utils = trpc.useUtils();
      await utils.recordings.list.invalidate();
    } catch (error) {
      toast.error("Failed to delete recording");
    }
  };

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Please sign in to continue</p>
          <Link href="/">
            <Button>Go to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Show loading state
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <OnboardingModal />
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/studyscribe-logo-YqjarSv2s9a5LtpKjX9CE5.webp"
              alt="StudyScribe AI"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              StudyScribe AI
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user?.name || user?.email}
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

      {/* Statistics Section */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-b border-border">
        <div className="container py-6">
          <h2 className="text-lg font-semibold mb-4 text-foreground">Your Study Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Hours */}
            <Card className="p-4 bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-800">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Hours Recorded</p>
                  <p className="text-2xl font-bold text-foreground mt-2">{statistics.totalHours}</p>
                  <p className="text-xs text-muted-foreground mt-1">hours</p>
                </div>
                <Clock className="w-6 h-6 text-blue-500 opacity-50" />
              </div>
            </Card>

            {/* Total Recordings */}
            <Card className="p-4 bg-white dark:bg-slate-900 border-purple-200 dark:border-purple-800">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Recordings</p>
                  <p className="text-2xl font-bold text-foreground mt-2">{statistics.totalRecordings}</p>
                  <p className="text-xs text-muted-foreground mt-1">lectures & meetings</p>
                </div>
                <Mic className="w-6 h-6 text-purple-500 opacity-50" />
              </div>
            </Card>

            {/* Study Progress */}
            <Card className="p-4 bg-white dark:bg-slate-900 border-green-200 dark:border-green-800">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Study Streak</p>
                  <p className="text-2xl font-bold text-foreground mt-2">Active</p>
                  <p className="text-xs text-muted-foreground mt-1">keep it up!</p>
                </div>
                <TrendingUp className="w-6 h-6 text-green-500 opacity-50" />
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container py-8">
        {/* Knowledge Base Quick Access */}
        <div className="flex justify-end mb-4">
          <Link href="/knowledge-base">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
              <Database className="w-4 h-4" />
              Knowledge Base
            </button>
          </Link>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Tab Navigation */}
          <TabsList className="grid w-full grid-cols-6 mb-8">
            <TabsTrigger value="library" className="gap-2">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">My Library</span>
            </TabsTrigger>
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
            <TabsTrigger value="trash" className="gap-2">
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Trash</span>
            </TabsTrigger>
          </TabsList>

          {/* My Library Tab */}
          <TabsContent value="library" className="space-y-6">
            <div className="space-y-4">
              <div className="flex gap-4 flex-col sm:flex-row">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search recordings..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="all">All Types</option>
                  <option value="student">Student</option>
                  <option value="professional">Professional</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="recent">Most Recent</option>
                  <option value="oldest">Oldest</option>
                  <option value="name">Alphabetical</option>
                </select>
              </div>
            </div>

            {filteredRecordings.length === 0 ? (
              <Card className="p-12 text-center">
                <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">No recordings yet</p>
                <Button onClick={() => setActiveTab("recorder")}>
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredRecordings.map((recording) => (
                  <Card key={recording.id} className="p-4 flex items-start justify-between hover:shadow-md transition-shadow">
                    <div className="flex-1">
                      <Link href={`/recording/${recording.id}`}>
                        <h4 className="font-semibold cursor-pointer hover:text-primary">{recording.title}</h4>
                      </Link>
                      <p className="text-sm text-muted-foreground">{new Date(recording.createdAt).toLocaleDateString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">{recording.audience}</p>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/recording/${recording.id}`}>
                        <Button size="sm" variant="outline">View</Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteRecording(recording.id)}
                        disabled={deleteRecordingMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Recorder Tab */}
          <TabsContent value="recorder">
            <RecordOrUpload />
          </TabsContent>

          {/* Transcription Tab */}
          <TabsContent value="transcription" className="space-y-6">
            <Card className="p-8 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">Select a recording from My Library to view its transcription</p>
              <Button onClick={() => setActiveTab("library")}>
                Go to My Library
              </Button>
            </Card>
          </TabsContent>

          {/* AI Tutor Tab */}
          <TabsContent value="tutor" className="space-y-6">
            <Card className="p-8 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">Select a recording from My Library to chat with the AI Tutor</p>
              <Button onClick={() => setActiveTab("library")}>
                Go to My Library
              </Button>
            </Card>
          </TabsContent>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-6">
            <Card className="p-8 text-center">
              <p className="text-muted-foreground mb-4">Select a recording from My Library to view study notes and flashcards</p>
              <Button onClick={() => setActiveTab("library")}>
                Go to My Library
              </Button>
            </Card>
          </TabsContent>

          {/* Trash Tab */}
          <TabsContent value="trash" className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Deleted Recordings</h3>
              <p className="text-sm text-muted-foreground">Recover deleted recordings from trash. Items are permanently deleted after 30 days.</p>
            </div>
            <TrashTabContent />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
