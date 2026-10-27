import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

const NONE = "none";

type Props = {
  source: { id: number; title: string; courseId: number | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Files a source under one of the person's active courses, or takes it out of its course. */
export function MoveSourceDialog({ source, open, onOpenChange }: Props) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data: courses } = trpc.courses.list.useQuery(undefined, { enabled: open });
  const update = trpc.sources.update.useMutation();
  const [value, setValue] = useState(source.courseId === null ? NONE : String(source.courseId));
  const active = (courses ?? []).filter(course => !course.archived);
  const current = source.courseId === null ? undefined : (courses ?? []).find(course => course.id === source.courseId);
  const currentArchived = current?.archived === true;

  useEffect(() => {
    if (open) setValue(source.courseId === null ? NONE : String(source.courseId));
  }, [open, source.courseId]);

  const unchanged = value === (source.courseId === null ? NONE : String(source.courseId));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (unchanged || update.isPending) return;
    try {
      await update.mutateAsync({ id: source.id, courseId: value === NONE ? null : Number.parseInt(value, 10) });
      await Promise.all([utils.sources.list.invalidate(), utils.sources.get.invalidate({ id: source.id })]);
      toast.success(t("files.move.done"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sources.error.failed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{t("files.move.title", { name: source.title })}</DialogTitle>
            <DialogDescription>{t("files.move.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`move-source-${source.id}`}>{t("fields.course.label")}</Label>
            <Select value={courses || source.courseId === null ? value : NONE} onValueChange={setValue}>
              <SelectTrigger id={`move-source-${source.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("files.move.none")}</SelectItem>
                {currentArchived && current && (
                  <SelectItem value={String(current.id)} disabled>
                    {t("files.move.archived", { course: current.name })}
                  </SelectItem>
                )}
                {active.map(course => (
                  <SelectItem key={course.id} value={String(course.id)}>
                    <span className="flex items-center gap-2">
                      <CourseDot color={course.color} className="size-2" />
                      {course.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("sources.paste.cancel")}
            </Button>
            <Button type="submit" disabled={unchanged || update.isPending}>
              {t("files.move.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
