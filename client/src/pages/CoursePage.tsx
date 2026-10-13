import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { ArchiveRestore, ArrowLeft, Archive, GraduationCap, Loader2, Mic, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseDialog } from "@/components/CourseDialog";
import { CourseVocabulary } from "@/components/CourseVocabulary";
import { CourseDot } from "@/components/CourseDot";
import { TagFilter } from "@/components/CourseStrip";
import { RecordingList } from "@/components/RecordingList";
import { trpc } from "@/lib/trpc";

export default function CoursePage() {
  const [, params] = useRoute("/courses/:id");
  const courseId = params?.id ? Number.parseInt(params.id, 10) : NaN;
  const validId = Number.isInteger(courseId) && courseId > 0;
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const utils = trpc.useUtils();

  const { data: course, isLoading: courseLoading } = trpc.courses.get.useQuery({ id: courseId }, { enabled: validId, retry: false });
  const { data: recordings, isLoading: recordingsLoading } = trpc.recordings.list.useQuery({ courseId }, { enabled: validId });
  const { data: courses } = trpc.courses.list.useQuery();
  const { data: tags } = trpc.tags.list.useQuery();

  const deleteRecording = trpc.recordings.delete.useMutation();
  const archive = trpc.courses.archive.useMutation({
    onError: error => toast.error(error.message || "Could not change the course"),
  });

  const refresh = () => Promise.all([utils.courses.list.invalidate(), utils.courses.get.invalidate({ id: courseId }), utils.recordings.list.invalidate()]);

  const handleDelete = async (id: number) => {
    try {
      await deleteRecording.mutateAsync({ id });
      toast.success("Recording moved to trash");
      await Promise.all([utils.recordings.list.invalidate(), utils.recordings.listDeleted.invalidate(), utils.courses.list.invalidate()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete recording");
    }
  };

  const setArchived = async (archived: boolean) => {
    await archive.mutateAsync({ id: courseId, archived });
    await refresh();
    if (archived) {
      navigate("/dashboard");
      toast.success("Course archived", {
        description: "Its recordings are still in your library.",
        action: {
          label: "Undo",
          onClick: () => {
            archive.mutate({ id: courseId, archived: false }, { onSuccess: () => void refresh() });
          },
        },
      });
    } else {
      toast.success("Course restored");
    }
  };

  const visible = (recordings ?? []).filter(recording => tagFilter.every(id => recording.tagIds.includes(id)));
  const sorted = [...visible].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const courseTags = (tags ?? []).filter(tag => (recordings ?? []).some(recording => recording.tagIds.includes(tag.id)));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Library
            </Button>
          </Link>
          {course && (
            <div className="flex items-center gap-2">
              {!course.archived && (
                <Link href={`/record-or-upload?course=${course.id}`}>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Mic className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">Record</span>
                  </Button>
                </Link>
              )}
              <Link href={`/ask?course=${course.id}`}>
                <Button size="sm" className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline">Ask this course</span>
                  <span className="sm:hidden">Ask</span>
                </Button>
              </Link>
              <Link href={`/exam-packs?course=${course.id}`}>
                <Button size="sm" variant="outline" className="gap-2">
                  <GraduationCap className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">Exam pack</span>
                </Button>
              </Link>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Edit</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={archive.isPending}
                onClick={() => void setArchived(!course.archived)}
              >
                {course.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                <span className="sr-only sm:not-sr-only">{course.archived ? "Restore" : "Archive"}</span>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main id="main-content" className="container pb-20 pt-10" tabIndex={-1}>
        {courseLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : !course ? (
          <div className="py-24 text-center">
            <h1 className="mb-2 text-2xl font-bold tracking-tight">Course not found</h1>
            <p className="mb-6 text-muted-foreground">It may have been removed, or it belongs to another account.</p>
            <Link href="/dashboard">
              <Button>Back to your library</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2.5 text-sm text-muted-foreground">
                <CourseDot color={course.color} className="size-2.5" />
                <span>{[course.term, `${recordings?.length ?? 0} recording${recordings?.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                {course.archived && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">Archived</span>}
              </div>
              <h1 className="text-4xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">{course.name}</h1>
            </div>

            {courseTags.length > 0 && (
              <div className="mb-5">
                <TagFilter
                  tags={courseTags.map(tag => ({ ...tag, recordingCount: 1 }))}
                  selected={tagFilter}
                  onToggle={id => setTagFilter(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))}
                />
              </div>
            )}

            {recordingsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
              </div>
            ) : sorted.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
                <p className="mx-auto max-w-md text-muted-foreground">
                  {recordings && recordings.length > 0
                    ? "No recordings in this course carry all of those tags."
                    : "Nothing filed here yet. Use the folder button on any recording in your library to move it into this course."}
                </p>
                {(!recordings || recordings.length === 0) && (
                  <Link href="/dashboard">
                    <Button variant="outline" className="mt-5">Open your library</Button>
                  </Link>
                )}
              </div>
            ) : (
              <RecordingList recordings={sorted} courses={courses} tags={tags} onDelete={handleDelete} showCourse={false} />
            )}

            <CourseVocabulary courseId={course.id} />
          </>
        )}
      </main>

      <CourseDialog open={editing} onOpenChange={setEditing} course={course ?? null} />
    </div>
  );
}
