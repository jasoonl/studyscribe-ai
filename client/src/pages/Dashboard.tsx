import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, Mic, FileText, MessageSquare, BookOpen, Plus, Search, Filter, Calendar, Clock } from "lucide-react";
import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import Record from "./Record";

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
      refetch();
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

      {/* Main Content */}
      <main className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Tab Navigation */}
          <TabsList className="grid w-full grid-cols-5 mb-8">
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
          </TabsList>

          {/* My Library Tab */}
          <TabsContent value="library" className="space-y-6">
            <div className="space-y-4">
              {/* Search and Filter Bar */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative md:col-span-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
                  className="px-3 py-2 rounded-md border border-border bg-background text-foreground"
                >
                  <option value="all">All Types</option>
                  <option value="student">Lectures</option>
                  <option value="professional">Meetings</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 rounded-md border border-border bg-background text-foreground"
                >
                  <option value="recent">Most Recent</option>
                  <option value="oldest">Oldest First</option>
                  <option value="name">Name (A-Z)</option>
                </select>
              </div>

              {/* Recording Count */}
              <div className="text-sm text-muted-foreground">
                {filteredRecordings.length} recording{filteredRecordings.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Recordings Grid */}
            {filteredRecordings.length === 0 ? (
              <Card className="p-12 text-center">
                <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">No recordings yet</p>
                <Button onClick={() => setActiveTab("recorder")}>
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRecordings.map((recording) => (
                  <Card key={recording.id} className="p-4 hover:border-accent/50 transition-colors cursor-pointer group">
                    <div className="space-y-3">
                      <div>
                        <h3 className="font-semibold text-foreground group-hover:text-accent transition-colors">
                          {recording.title}
                        </h3>
                        <p className="text-xs text-muted-foreground capitalize">
                          {recording.audience === "student" ? "Lecture" : "Meeting"}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(recording.createdAt).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {recording.duration ? `${Math.round(recording.duration / 60)}m` : "Processing"}
                        </div>
                      </div>

                      {recording.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {recording.description}
                        </p>
                      )}

                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => navigate(`/recording/${recording.id}`)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRecording(recording.id)}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Recorder Tab */}
          <TabsContent value="recorder">
            <Record />
          </TabsContent>

          {/* Transcription Tab */}
          <TabsContent value="transcription" className="space-y-4">
            <Card className="p-8 text-center">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">Select a recording from My Library to view its transcript</p>
              <Button onClick={() => setActiveTab("library")}>
                Go to My Library
              </Button>
            </Card>
          </TabsContent>

          {/* AI Tutor Tab */}
          <TabsContent value="tutor" className="space-y-4">
            <Card className="p-8 text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">Select a recording from My Library to chat with AI Tutor</p>
              <Button onClick={() => setActiveTab("library")}>
                Go to My Library
              </Button>
            </Card>
          </TabsContent>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-4">
            <Card className="p-8 text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">Select a recording from My Library to view study notes and flashcards</p>
              <Button onClick={() => setActiveTab("library")}>
                Go to My Library
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
