import { useState } from "react";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseDialog } from "@/components/CourseDialog";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const chip =
  "inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The course entry point on the library: one chip per course, linking to its page. */
export function CourseStrip() {
  const { data: courses, isLoading } = trpc.courses.list.useQuery();
  const [creating, setCreating] = useState(false);
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const { data: allCourses } = trpc.courses.list.useQuery({ includeArchived: true });
  const archived = (allCourses ?? []).filter(course => course.archived);

  if (isLoading) return <div className="h-[72px]" aria-hidden />;

  return (
    <section aria-labelledby="course-strip-heading" className="mb-6">
      <h2 id="course-strip-heading" className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("courses.heading")}
      </h2>
      {courses && courses.length > 0 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {courses.map(course => (
            <Link key={course.id} href={`/courses/${course.id}`} className={chip}>
              <CourseDot color={course.color} />
              <span className="max-w-44 truncate font-medium">{course.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{course.recordingCount}</span>
            </Link>
          ))}
          <button type="button" onClick={() => setCreating(true)} className={cn(chip, "border-dashed bg-transparent text-muted-foreground hover:text-foreground")}>
            <Plus className="size-3.5" />
            {t("courses.new")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {t("courses.emptyHelp")}
          </p>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} className="shrink-0 gap-1.5">
            <Plus className="size-3.5" />
            {t("courses.new")}
          </Button>
        </div>
      )}
      {archived.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived(value => !value)}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t(showArchived ? "courses.hideArchived" : "courses.showArchived", { count: archived.length })}
          </button>
          {showArchived && (
            <div className="mt-2 flex flex-wrap gap-2">
              {archived.map(course => (
                <Link key={course.id} href={`/courses/${course.id}`} className={cn(chip, "text-muted-foreground")}>
                  <CourseDot color={course.color} />
                  <span className="max-w-44 truncate">{course.name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      <CourseDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}

/** Toggle chips that narrow a list of recordings to those carrying every selected tag. */
export function TagFilter({
  tags,
  selected,
  onToggle,
}: {
  tags: Array<{ id: number; name: string; color: string | null; recordingCount: number }> | undefined;
  selected: number[];
  onToggle: (tagId: number) => void;
}) {
  const { t } = useI18n();
  const visible = (tags ?? []).filter(tag => tag.recordingCount > 0 || selected.includes(tag.id));
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("courses.filterByTag")}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("courses.tags")}</span>
      {visible.map(tag => {
        const active = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(tag.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-secondary/60",
            )}
          >
            {!active && <CourseDot color={tag.color} className="size-1.5" />}
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
