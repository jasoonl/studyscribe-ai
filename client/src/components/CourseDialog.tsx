import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COURSE_COLOR_KEYS, COURSE_COLOR_LABEL, courseDotClass, type CourseColorKey } from "@/lib/courseColors";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Check } from "lucide-react";

export type EditableCourse = { id: number; name: string; color: string; term: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when renaming or recolouring; absent when creating. */
  course?: EditableCourse | null;
  onSaved?: (courseId: number) => void;
};

/** Pick one of the palette colours; also used for tags. */
export function ColorSwatches({ value, onChange, label = "Colour" }: { value: CourseColorKey; onChange: (value: CourseColorKey) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {COURSE_COLOR_KEYS.map(key => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={COURSE_COLOR_LABEL[key]}
          onClick={() => onChange(key)}
          className={cn(
            "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            courseDotClass(key),
            value === key && "ring-2 ring-foreground/70",
          )}
        >
          {value === key && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function CourseDialog({ open, onOpenChange, course, onSaved }: Props) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [color, setColor] = useState<CourseColorKey>("blue");

  useEffect(() => {
    if (!open) return;
    setName(course?.name ?? "");
    setTerm(course?.term ?? "");
    setColor((COURSE_COLOR_KEYS as readonly string[]).includes(course?.color ?? "") ? (course!.color as CourseColorKey) : "blue");
  }, [open, course]);

  const refresh = async () => {
    await Promise.all([utils.courses.list.invalidate(), utils.courses.get.invalidate(), utils.recordings.list.invalidate()]);
  };

  const create = trpc.courses.create.useMutation({
    onSuccess: async result => {
      await refresh();
      toast.success("Course created");
      onOpenChange(false);
      onSaved?.(result.id);
    },
    onError: error => toast.error(error.message || "Could not create the course"),
  });
  const update = trpc.courses.update.useMutation({
    onSuccess: async result => {
      await refresh();
      toast.success("Course updated");
      onOpenChange(false);
      onSaved?.(result.id);
    },
    onError: error => toast.error(error.message || "Could not update the course"),
  });

  const pending = create.isPending || update.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending) return;
    if (course) update.mutate({ id: course.id, name, color, term });
    else create.mutate({ name, color, term: term || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
            <DialogDescription>
              {course ? "Rename it or change its colour. Its recordings stay where they are." : "Courses group related lectures so you can browse them together and ask questions across just that course."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="course-name">Name</Label>
            <Input id="course-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="BIO 101: Cell Biology" autoFocus required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-term">Term <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="course-term" value={term} onChange={event => setTerm(event.target.value)} maxLength={64} placeholder="Fall 2026" />
          </div>
          <div className="space-y-2">
            <Label>Colour</Label>
            <ColorSwatches value={color} onChange={setColor} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || pending}>{pending ? "Saving…" : course ? "Save changes" : "Create course"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
