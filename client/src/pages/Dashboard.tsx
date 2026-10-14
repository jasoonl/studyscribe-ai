import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, Mic, FileText, MessageSquare, BookOpen, Plus, Search, Filter, Calendar, Sparkles, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { lazy, Suspense, useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
// The recorder tab loads its code only when opened (upload client, live transcript, study help).
const RecordOrUpload = lazy(() => import("./RecordOrUpload"));
import { useAuth } from "@/_core/hooks/useAuth";
import { OnboardingModal } from "@/components/OnboardingModal";
import { NotificationBell } from "@/components/NotificationBell";
import { RecordingList } from "@/components/RecordingList";
import { useTrashRecording } from "@/hooks/useTrashRecording";
import { CourseStrip, TagFilter } from "@/components/CourseStrip";
import { UpcomingTasks } from "@/components/UpcomingTasks";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { EmailConfirmationBanner } from "@/components/EmailConfirmationBanner";
import { UpcomingEvents } from "@/components/UpcomingEvents";
import { MeetingNoteTakers, SendNoteTakerDialog, type NoteTakerPrefill } from "@/components/MeetingNoteTakers";

function TrashTabContent() {
  const { data: deletedRecordings, isLoading } = trpc.recordings.listDeleted.useQuery();
  const restoreMutation = trpc.recordings.restore.useMutation();
  const permanentDeleteMutation = trpc.recordings.permanentDelete.useMutation();
  const emptyTrashMutation = trpc.recordings.emptyTrash.useMutation();
  const utils = trpc.useUtils();

  const handleEmptyTrash = async (count: number) => {
    if (!confirm(`Permanently delete all ${count} recordings in the trash, including their audio files? This cannot be undone.`)) {
      return;
    }
    try {
      const result = await emptyTrashMutation.mutateAsync();
      toast.success(`Permanently deleted ${result.deleted} recording${result.deleted === 1 ? "" : "s"} and freed their storage`);
      await utils.recordings.listDeleted.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to empty the trash");
    }
  };

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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {deletedRecordings.length} recording{deletedRecordings.length === 1 ? "" : "s"} in the trash. Deleting forever also frees the stored audio.
        </p>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => handleEmptyTrash(deletedRecordings.length)}
          disabled={emptyTrashMutation.isPending}
        >
          {emptyTrashMutation.isPending ? "Deleting..." : "Delete all forever"}
        </Button>
      </div>
      {deletedRecordings.map((recording) => (
        <Card key={recording.id} className="p-4 flex items-start justify-between">
          <div>
            <h4 className="font-semibold">{recording.title}</h4>
            <p className="text-sm text-muted-foreground">Deleted {recording.deletedAt ? new Date(recording.deletedAt).toLocaleDateString() : "recently"}</p>
          </div>
          <div className="flex gap-1 text-xs sm:text-sm px-2 sm:px-3">
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
  const { user, logout, loading: authLoading, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("library");
  const [noteTaker, setNoteTaker] = useState<NoteTakerPrefill | null>(null);
  const teamName = trpc.teams.mine.useQuery(undefined, { staleTime: 5 * 60_000, retry: false }).data?.org?.name ?? null;
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "student" | "professional">("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "name">("recent");
  const [tagFilter, setTagFilter] = useState<number[]>([]);

  // Fetch recordings
  const { data: recordings, isLoading, refetch } = trpc.recordings.list.useQuery();
  const { data: courses } = trpc.courses.list.useQuery();
  const { data: tags } = trpc.tags.list.useQuery();
  const utils = trpc.useUtils();  // Must be at component level, not inside callbacks

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

    // Keep recordings that carry every selected tag
    if (tagFilter.length > 0) {
      filtered = filtered.filter(r => tagFilter.every(id => r.tagIds.includes(id)));
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
  }, [recordings, searchQuery, filterType, sortBy, tagFilter]);

  const handleDeleteRecording = useTrashRecording();

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
      <header className="border-b border-border/50 glass sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.webp"
              alt="StudyScribe AI"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold text-primary">
              StudyScribe AI
            </span>
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-[12rem] gap-1.5" aria-label="Account menu">
                  <span className="truncate">{user?.name?.split(" ")[0] || "Account"}</span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/billing">Plan and billing</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/help">Help</Link></DropdownMenuItem>
                {isAdmin && <DropdownMenuItem asChild><Link href="/admin">Admin</Link></DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logout()}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Statistics Section */}
      <div>
        <div className="container pt-12 pb-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-[-0.04em] mb-8 text-foreground">Your library</h1>
          <p className="-mt-5 text-base text-muted-foreground tabular-nums">
            {statistics.totalRecordings} {statistics.totalRecordings === 1 ? "recording" : "recordings"} · {statistics.totalHours} hours recorded
          </p>
        </div>
      </div>

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="container py-6 pb-20 focus:outline-none">
        <nav aria-label="Study tools" className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-2">
          <Button asChild size="sm" className="mr-2 rounded-full">
            <Link href="/ask"><Sparkles className="size-4" aria-hidden="true" />Ask StudyScribe</Link>
          </Button>
          {[
            { href: "/plan", label: "Study plan" },
            { href: "/tasks", label: "Tasks" },
            { href: "/exam-packs", label: "Exam packs" },
            { href: "/knowledge-base", label: "Knowledge Base" },
            { href: "/progress", label: "Progress" },
            { href: "/groups", label: "Groups" },
            { href: "/shared-with-me", label: "Shared with me" },
            ...(teamName ? [{ href: "/team", label: teamName }] : []),
          ].map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="max-w-[12rem] truncate rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Tab Navigation */}
          <div className="-mx-4 mb-10 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList className="w-max min-w-full sm:grid sm:w-full sm:grid-cols-6">
              <TabsTrigger value="library" className="px-3 text-sm">My Library</TabsTrigger>
              <TabsTrigger value="recorder" className="px-3 text-sm">Record or upload</TabsTrigger>
              <TabsTrigger value="transcription" className="px-3 text-sm">Transcription</TabsTrigger>
              <TabsTrigger value="tutor" className="px-3 text-sm">AI Tutor</TabsTrigger>
              <TabsTrigger value="summary" className="px-3 text-sm">Summary</TabsTrigger>
              <TabsTrigger value="trash" className="px-3 text-sm">Trash</TabsTrigger>
            </TabsList>
          </div>

          {/* My Library Tab */}
          <TabsContent value="library" className="space-y-6">
            <EmailConfirmationBanner />
            {user && <OnboardingChecklist userId={user.id} onOpenRecorder={() => setActiveTab("recorder")} />}
            <UpcomingEvents
              onRecord={() => setActiveTab("recorder")}
              onSendNoteTaker={event => setNoteTaker({ meetingUrl: event.meetingUrl, title: event.title, calendarEventId: event.id, start: event.start })}
            />
            <MeetingNoteTakers onSend={() => setNoteTaker({})} />
            <SendNoteTakerDialog prefill={noteTaker} onClose={() => setNoteTaker(null)} />
            <CourseStrip />
            <UpcomingTasks />
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
              <TagFilter
                tags={tags}
                selected={tagFilter}
                onToggle={id => setTagFilter(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))}
              />
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
              <RecordingList
                recordings={filteredRecordings}
                courses={courses}
                tags={tags}
                onDelete={handleDeleteRecording}
              />
            )}
          </TabsContent>

          {/* Recorder Tab */}
          <TabsContent value="recorder">
            <Suspense fallback={<div className="flex justify-center py-16" role="status"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /><span className="sr-only">Loading the recorder</span></div>}>
              <RecordOrUpload embedded />
            </Suspense>
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
