import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { ArchiveRestore, ArrowLeft, Archive, FileText, GraduationCap, Loader2, Mic, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseDialog } from "@/components/CourseDialog";
import { CourseVocabulary } from "@/components/CourseVocabulary";
import { CourseDot } from "@/components/CourseDot";
import { TagFilter } from "@/components/CourseStrip";
import { SourceStatusBadge } from "@/components/sources/SourceStatusBadge";
import { RecordingList } from "@/components/RecordingList";
import { useTrashRecording } from "@/hooks/useTrashRecording";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

export default function CoursePage() {
  const { t, tn } = useI18n();
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
  const { data: sourceList } = trpc.sources.list.useQuery({ courseId }, { enabled: validId });
  const { data: tags } = trpc.tags.list.useQuery();

  const archive = trpc.courses.archive.useMutation({
    onError: error => toast.error(error.message || t("course.changeFailed")),
  });

  const refresh = () => Promise.all([utils.courses.list.invalidate(), utils.courses.get.invalidate({ id: courseId }), utils.recordings.list.invalidate()]);

  const handleDelete = useTrashRecording();

  const setArchived = async (archived: boolean) => {
    await archive.mutateAsync({ id: courseId, archived });
    await refresh();
    if (archived) {
      navigate("/dashboard");
      toast.success(t("course.archived"), {
        description: t("course.archivedHint"),
        action: {
          label: t("course.undo"),
          onClick: () => {
            archive.mutate({ id: courseId, archived: false }, { onSuccess: () => void refresh() });
          },
        },
      });
    } else {
      toast.success(t("course.restored"));
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
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t("common.library")}</span>
            </Button>
          </Link>
          {course && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {!course.archived && (
                <Link href={`/record-or-upload?course=${course.id}`}>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Mic className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">{t("course.record")}</span>
                  </Button>
                </Link>
              )}
              <Link href={`/ask?course=${course.id}`}>
                <Button size="sm" className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("course.askCourse")}</span>
                  <span className="sm:hidden">{t("course.ask")}</span>
                </Button>
              </Link>
              {sourceList?.available !== false && (
                <Link href={`/courses/${course.id}/sources`}>
                  <Button size="sm" variant="outline" className="gap-2">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">{t("course.sources")}</span>
                  </Button>
                </Link>
              )}
              <Link href={`/exam-packs?course=${course.id}`}>
                <Button size="sm" variant="outline" className="gap-2">
                  <GraduationCap className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">{t("course.examPack")}</span>
                </Button>
              </Link>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t("course.edit")}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={archive.isPending}
                onClick={() => void setArchived(!course.archived)}
              >
                {course.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                <span className="sr-only sm:not-sr-only">{course.archived ? t("course.restore") : t("course.archive")}</span>
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
            <h1 className="mb-2 text-2xl font-bold tracking-tight">{t("course.notFound")}</h1>
            <p className="mb-6 text-muted-foreground">{t("course.notFoundHint")}</p>
            <Link href="/dashboard">
              <Button>{t("course.backToLibrary")}</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2.5 text-sm text-muted-foreground">
                <CourseDot color={course.color} className="size-2.5" />
                <span>{[course.term, tn("course.recordings", recordings?.length ?? 0)].filter(Boolean).join(" · ")}</span>
                {course.archived && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{t("course.archivedBadge")}</span>}
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
                    ? t("course.noTagMatch")
                    : t("course.empty")}
                </p>
                {(!recordings || recordings.length === 0) && (
                  <Link href="/dashboard">
                    <Button variant="outline" className="mt-5">{t("course.openLibrary")}</Button>
                  </Link>
                )}
              </div>
            ) : (
              <>
                <h2 className="sr-only">{t("course.recordingsHeading")}</h2>
                <RecordingList recordings={sorted} courses={courses} tags={tags} onDelete={handleDelete} showCourse={false} />
              </>
            )}

            {sourceList?.available && (
              <section aria-labelledby="course-sources-heading" className="mt-10">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id="course-sources-heading" className="text-lg font-semibold tracking-tight">
                    {t("course.sources")}
                  </h2>
                  <Link href={`/courses/${course.id}/sources`} className="text-sm font-medium text-primary underline underline-offset-2">
                    {sourceList.sources.length > 0 ? t("sources.seeAll") : t("sources.addSources")}
                  </Link>
                </div>
                {sourceList.sources.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">{t("sources.empty.course")}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                    {sourceList.sources.slice(0, 3).map(source => (
                      <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <Link href={`/sources/${source.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                          {source.title}
                        </Link>
                        <SourceStatusBadge status={source.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <CourseVocabulary courseId={course.id} />
          </>
        )}
      </main>

      <CourseDialog open={editing} onOpenChange={setEditing} course={course ?? null} />
    </div>
  );
}
