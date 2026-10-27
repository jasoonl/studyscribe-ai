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
import { formatDate, formatNumber, t, tn, useI18n } from "@/i18n";
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
  useI18n();

  const handleEmptyTrash = async (count: number) => {
    if (!confirm(tn("trash.confirmAll", count))) {
      return;
    }
    try {
      const result = await emptyTrashMutation.mutateAsync();
      toast.success(tn("trash.emptied", result.deleted));
      await utils.recordings.listDeleted.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("trash.emptyFailed"));
    }
  };

  const handleRestore = async (id: number) => {
    try {
      await restoreMutation.mutateAsync({ id });
      toast.success(t("trash.restored"));
      // Invalidate both deleted and active recordings lists
      await utils.recordings.listDeleted.invalidate();
      await utils.recordings.list.invalidate();
    } catch (error) {
      toast.error(t("trash.restoreFailed"));
    }
  };

  const handlePermanentDelete = async (id: number, title: string) => {
    if (!confirm(t("trash.confirmOne", { title }))) {
      return;
    }
    try {
      await permanentDeleteMutation.mutateAsync({ id });
      toast.success(t("trash.deleted"));
      // Invalidate deleted recordings list
      await utils.recordings.listDeleted.invalidate();
    } catch (error) {
      toast.error(t("trash.deleteFailed"));
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
        <p className="text-muted-foreground">{t("trash.empty")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {tn("trash.count", deletedRecordings.length)}
        </p>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => handleEmptyTrash(deletedRecordings.length)}
          disabled={emptyTrashMutation.isPending}
        >
          {emptyTrashMutation.isPending ? t("trash.deleting") : t("trash.deleteAll")}
        </Button>
      </div>
      {deletedRecordings.map((recording) => (
        <Card key={recording.id} className="p-4 flex items-start justify-between">
          <div>
            <h4 className="font-semibold">{recording.title}</h4>
            <p className="text-sm text-muted-foreground">{recording.deletedAt ? t("trash.deletedOn", { date: formatDate(recording.deletedAt) }) : t("trash.deletedRecently")}</p>
          </div>
          <div className="flex gap-1 text-xs sm:text-sm px-2 sm:px-3">
            <Button
              size="sm"
              onClick={() => handleRestore(recording.id)}
              disabled={restoreMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {t("trash.restore")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handlePermanentDelete(recording.id, recording.title)}
              disabled={permanentDeleteMutation.isPending}
            >
              {t("trash.deleteForever")}
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
  const { language } = useI18n();
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
    const totalHours = formatNumber(totalSeconds / 3600, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const totalRecordings = recordings?.length || 0;

    return {
      totalHours,
      totalRecordings,
    };
  }, [recordings, language]);

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
          <p className="text-muted-foreground mb-4">{t("library.signInFirst")}</p>
          <Link href="/">
            <Button>{t("library.goHome")}</Button>
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
                <Button variant="outline" size="sm" className="max-w-[12rem] gap-1.5" aria-label={t("library.accountMenu")}>
                  <span className="truncate">{user?.name?.split(" ")[0] || t("library.account")}</span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/settings">{t("common.settings")}</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/billing">{t("library.billing")}</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/invite-friends">{t("library.inviteFriends")}</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/help">{t("library.help")}</Link></DropdownMenuItem>
                {isAdmin && <DropdownMenuItem asChild><Link href="/admin">{t("library.admin")}</Link></DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logout()}>{t("library.signOut")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Statistics Section */}
      <div>
        <div className="container pt-12 pb-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-[-0.04em] mb-8 text-foreground">{t("library.title")}</h1>
          <p className="-mt-5 text-base text-muted-foreground tabular-nums">
            {tn("library.recordings", statistics.totalRecordings)} · {t("library.hours", { hours: statistics.totalHours })}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="container py-6 pb-20 focus:outline-none">
        <nav aria-label={t("library.studyTools")} className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-2">
          <Button asChild size="sm" className="mr-2 rounded-full">
            <Link href="/ask"><Sparkles className="size-4" aria-hidden="true" />{t("library.ask")}</Link>
          </Button>
          {[
            { href: "/plan", label: t("library.plan") },
            { href: "/files", label: t("library.files") },
            { href: "/notes", label: t("library.notes") },
            { href: "/tasks", label: t("library.tasks") },
            { href: "/exam-packs", label: t("library.examPacks") },
            { href: "/knowledge-base", label: t("library.knowledgeBase") },
            { href: "/progress", label: t("library.progress") },
            { href: "/groups", label: t("library.groups") },
            { href: "/shared-with-me", label: t("library.sharedWithMe") },
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
              <TabsTrigger value="library" className="px-3 text-sm">{t("library.tabLibrary")}</TabsTrigger>
              <TabsTrigger value="recorder" className="px-3 text-sm">{t("library.tabRecord")}</TabsTrigger>
              <TabsTrigger value="transcription" className="px-3 text-sm">{t("library.tabTranscription")}</TabsTrigger>
              <TabsTrigger value="tutor" className="px-3 text-sm">{t("library.tabTutor")}</TabsTrigger>
              <TabsTrigger value="summary" className="px-3 text-sm">{t("library.tabSummary")}</TabsTrigger>
              <TabsTrigger value="trash" className="px-3 text-sm">{t("library.tabTrash")}</TabsTrigger>
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
                    placeholder={t("library.search")}
                    aria-label={t("library.searchLabel")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <select
                  aria-label={t("library.typeLabel")}
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="all">{t("library.allTypes")}</option>
                  <option value="student">{t("library.student")}</option>
                  <option value="professional">{t("library.professional")}</option>
                </select>
                <select
                  aria-label={t("library.sortLabel")}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="recent">{t("library.sortRecent")}</option>
                  <option value="oldest">{t("library.sortOldest")}</option>
                  <option value="name">{t("library.sortName")}</option>
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
                <p className="text-muted-foreground mb-4">{t("library.empty")}</p>
                <Button onClick={() => setActiveTab("recorder")}>
                  <Mic className="w-4 h-4 mr-2" />
                  {t("library.startRecording")}
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
            <Suspense fallback={<div className="flex justify-center py-16" role="status"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /><span className="sr-only">{t("library.loadingRecorder")}</span></div>}>
              <RecordOrUpload embedded />
            </Suspense>
          </TabsContent>

          {/* Transcription Tab */}
          <TabsContent value="transcription" className="space-y-6">
            <Card className="p-8 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">{t("library.pickTranscript")}</p>
              <Button onClick={() => setActiveTab("library")}>
                {t("library.goToLibrary")}
              </Button>
            </Card>
          </TabsContent>

          {/* AI Tutor Tab */}
          <TabsContent value="tutor" className="space-y-6">
            <Card className="p-8 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">{t("library.pickTutor")}</p>
              <Button onClick={() => setActiveTab("library")}>
                {t("library.goToLibrary")}
              </Button>
            </Card>
          </TabsContent>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-6">
            <Card className="p-8 text-center">
              <p className="text-muted-foreground mb-4">{t("library.pickSummary")}</p>
              <Button onClick={() => setActiveTab("library")}>
                {t("library.goToLibrary")}
              </Button>
            </Card>
          </TabsContent>

          {/* Trash Tab */}
          <TabsContent value="trash" className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{t("trash.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("trash.help")}</p>
            </div>
            <TrashTabContent />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
