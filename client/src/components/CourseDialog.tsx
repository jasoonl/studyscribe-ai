import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COURSE_COLOR_KEYS, courseDotClass, type CourseColorKey } from "@/lib/courseColors";
import { t, useI18n } from "@/i18n";
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
export function ColorSwatches({ value, onChange, label }: { value: CourseColorKey; onChange: (value: CourseColorKey) => void; label?: string }) {
  useI18n();
  return (
    <div role="radiogroup" aria-label={label ?? t("course.dialog.colour")} className="flex flex-wrap gap-2">
      {COURSE_COLOR_KEYS.map(key => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={t(`course.color.${key}`)}
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
  useI18n();
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
      toast.success(t("course.dialog.created"));
      onOpenChange(false);
      onSaved?.(result.id);
    },
    onError: error => toast.error(error.message || t("course.dialog.createFailed")),
  });
  const update = trpc.courses.update.useMutation({
    onSuccess: async result => {
      await refresh();
      toast.success(t("course.dialog.updated"));
      onOpenChange(false);
      onSaved?.(result.id);
    },
    onError: error => toast.error(error.message || t("course.dialog.updateFailed")),
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
            <DialogTitle>{course ? t("course.dialog.editTitle") : t("course.dialog.newTitle")}</DialogTitle>
            <DialogDescription>
              {course ? t("course.dialog.editDescription") : t("course.dialog.newDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="course-name">{t("course.dialog.name")}</Label>
            <Input id="course-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder={t("course.dialog.namePlaceholder")} autoFocus required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-term">{t("course.dialog.term")} <span className="font-normal text-muted-foreground">{t("course.dialog.optional")}</span></Label>
            <Input id="course-term" value={term} onChange={event => setTerm(event.target.value)} maxLength={64} placeholder={t("course.dialog.termPlaceholder")} />
          </div>
          <div className="space-y-2">
            <Label>{t("course.dialog.colour")}</Label>
            <ColorSwatches value={color} onChange={setColor} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("course.dialog.cancel")}</Button>
            <Button type="submit" disabled={!name.trim() || pending}>{pending ? t("course.dialog.saving") : course ? t("course.dialog.saveChanges") : t("course.dialog.create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
