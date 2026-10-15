import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { t, useI18n } from "@/i18n";

export const NO_COURSE = "none";

/** The picked course as sent with `recordings.create`/`createFromUrl`. */
export function courseForRequest(value: string): number | undefined {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Optional course for a new recording. Filing it before transcription means
 * the course's vocabulary is used. Renders nothing for people without courses.
 */
export function CourseSelect({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  useI18n();
  const { data: courses } = trpc.courses.list.useQuery();
  const active = (courses ?? []).filter(course => !course.archived);
  if (active.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("fields.course.label")}</Label>
      <Select value={active.some(course => String(course.id) === value) ? value : NO_COURSE} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_COURSE}>{t("fields.course.none")}</SelectItem>
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
      <p className="text-xs text-muted-foreground">{t("fields.course.help")}</p>
    </div>
  );
}
