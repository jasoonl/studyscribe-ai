import { useState } from "react";
import { toast } from "sonner";
import { Check, FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CourseDialog } from "@/components/CourseDialog";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Props = {
  recordingId: number;
  courseId: number | null;
  tagIds: number[];
  /** "icon" is the compact button for list rows; "field" is a labelled button for the detail page. */
  variant?: "icon" | "field";
  className?: string;
};

const MAX_TAGS_PER_RECORDING = 12;

/**
 * One popover to file a recording: pick its course (one at most) and toggle
 * its tags. Shared by the library rows and the recording page.
 */
export function RecordingOrganizer({ recordingId, courseId, tagIds, variant = "icon", className }: Props) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [newTag, setNewTag] = useState("");

  const { data: courses } = trpc.courses.list.useQuery();
  const { data: tags } = trpc.tags.list.useQuery();

  const refresh = () => Promise.all([utils.recordings.list.invalidate(), utils.recordings.get.invalidate({ id: recordingId }), utils.courses.list.invalidate(), utils.tags.list.invalidate()]);

  const setCourse = trpc.recordings.setCourse.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message || "Could not change the course"),
  });
  const setTags = trpc.tags.setForRecording.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message || "Could not change the tags"),
  });
  const createTag = trpc.tags.create.useMutation({
    onSuccess: async result => {
      setNewTag("");
      await utils.tags.list.invalidate();
      if (!tagIds.includes(result.id) && tagIds.length < MAX_TAGS_PER_RECORDING) setTags.mutate({ recordingId, tagIds: [...tagIds, result.id] });
    },
    onError: error => toast.error(error.message || "Could not create the tag"),
  });

  const current = courses?.find(course => course.id === courseId);
  const label = current ? current.name : "Add to a course";

  const toggleTag = (tagId: number) => {
    const next = tagIds.includes(tagId) ? tagIds.filter(id => id !== tagId) : [...tagIds, tagId];
    if (next.length > MAX_TAGS_PER_RECORDING) {
      toast.error(`A recording can have up to ${MAX_TAGS_PER_RECORDING} tags.`);
      return;
    }
    setTags.mutate({ recordingId, tagIds: next });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {variant === "icon" ? (
            <Button size="icon" variant="outline" className={cn("size-8 shrink-0", className)} aria-label="Course and tags">
              <FolderOpen className="size-4" />
            </Button>
          ) : (
            <Button size="sm" variant="outline" className={cn("h-8 gap-2 font-normal", className)}>
              {current ? <CourseDot color={current.color} /> : <FolderOpen className="size-4 text-muted-foreground" />}
              <span className="max-w-48 truncate">{label}</span>
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-4 p-3">
          <section aria-label="Course" className="space-y-1">
            <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Course</p>
            <ul className="max-h-48 overflow-y-auto">
              <PickRow selected={courseId === null} onClick={() => setCourse.mutate({ recordingId, courseId: null })}>
                <span className="text-muted-foreground">No course</span>
              </PickRow>
              {courses?.map(course => (
                <PickRow key={course.id} selected={course.id === courseId} onClick={() => setCourse.mutate({ recordingId, courseId: course.id })}>
                  <CourseDot color={course.color} />
                  <span className="truncate">{course.name}</span>
                </PickRow>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreatingCourse(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-4" /> New course
            </button>
          </section>

          <section aria-label="Tags" className="space-y-1 border-t border-border pt-3">
            <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
            {tags && tags.length > 0 && (
              <ul className="max-h-40 overflow-y-auto">
                {tags.map(tag => (
                  <PickRow key={tag.id} selected={tagIds.includes(tag.id)} onClick={() => toggleTag(tag.id)} multi>
                    <CourseDot color={tag.color} />
                    <span className="truncate">{tag.name}</span>
                  </PickRow>
                ))}
              </ul>
            )}
            <form
              className="flex gap-2 px-1 pt-1"
              onSubmit={event => {
                event.preventDefault();
                if (newTag.trim()) createTag.mutate({ name: newTag });
              }}
            >
              <Input value={newTag} onChange={event => setNewTag(event.target.value)} maxLength={40} placeholder="New tag" aria-label="New tag name" className="h-8" />
              <Button type="submit" size="sm" variant="secondary" disabled={!newTag.trim() || createTag.isPending}>Add</Button>
            </form>
          </section>
        </PopoverContent>
      </Popover>

      <CourseDialog
        open={creatingCourse}
        onOpenChange={setCreatingCourse}
        onSaved={newCourseId => setCourse.mutate({ recordingId, courseId: newCourseId })}
      />
    </>
  );
}

function PickRow({ selected, onClick, children, multi = false }: { selected: boolean; onClick: () => void; children: React.ReactNode; multi?: boolean }) {
  return (
    <li>
      <button
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
        <Check className={cn("ml-auto size-4 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")} />
      </button>
    </li>
  );
}
