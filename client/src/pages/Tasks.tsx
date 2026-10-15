import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CourseDot } from "@/components/CourseDot";
import { TaskItem } from "@/components/TaskItem";
import { trpc } from "@/lib/trpc";
import { groupActionItems, localIsoDate } from "@shared/actionItems";
import { useI18n } from "@/i18n";

/** Every task and deadline across the library, by when it is due (C3). */
export default function Tasks() {
  const { t, formatNumber } = useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.actionItems.listAll.useQuery();
  const { data: courses } = trpc.courses.list.useQuery();
  const [course, setCourse] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const today = localIsoDate(new Date());

  const items = data?.items ?? [];
  const filtered = useMemo(
    () => items.filter(item => course === "all" || (course === "none" ? item.courseId === null : item.courseId === Number(course))),
    [items, course],
  );
  const groups = groupActionItems(filtered, today).filter(group => showDone || group.id !== "done");
  const doneCount = filtered.filter(item => item.done).length;
  const openCount = filtered.length - doneCount;
  const courseById = new Map((courses ?? []).map(entry => [entry.id, entry]));
  const refresh = () => Promise.all([utils.actionItems.listAll.invalidate(), utils.actionItems.list.invalidate()]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("common.library")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("library.tasks")}</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {t("tasksPage.subtitle")}
            </p>
          </div>
          {items.length > 0 && (
            <div className="flex flex-wrap items-end gap-4">
              {(courses?.length ?? 0) > 0 && (
                <div className="w-48">
                  <Label htmlFor="tasks-course" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("fields.course.label")}</Label>
                  <Select value={course} onValueChange={setCourse}>
                    <SelectTrigger id="tasks-course" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("tasksPage.allCourses")}</SelectItem>
                      {courses!.map(entry => (
                        <SelectItem key={entry.id} value={String(entry.id)}>
                          <span className="flex items-center gap-2"><CourseDot color={entry.color} />{entry.name}</span>
                        </SelectItem>
                      ))}
                      <SelectItem value="none">{t("tasksPage.noCourse")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex h-9 items-center gap-2">
                <Switch id="tasks-done" checked={showDone} onCheckedChange={setShowDone} />
                <Label htmlFor="tasks-done" className="text-sm">{t("tasksPage.showDone")}{doneCount > 0 && <span className="ml-1 tabular-nums text-muted-foreground">{formatNumber(doneCount)}</span>}</Label>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div>
        ) : data && !data.available ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">{t("tasksPage.unavailable")}</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <p className="mx-auto max-w-md text-muted-foreground">
              {t("tasksPage.empty")}
            </p>
            <Link href="/dashboard">
              <Button variant="outline" className="mt-5">{t("plan.openLibrary")}</Button>
            </Link>
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
            {openCount === 0 && doneCount > 0 ? t("tasksPage.allDone") : t("tasksPage.noMatch")}
          </p>
        ) : (
          <div className="space-y-8">
            {groups.map(group => (
              <section key={group.id} aria-labelledby={`group-${group.id}`}>
                <h2 id={`group-${group.id}`} className={`mb-1 flex items-baseline gap-2 text-sm font-semibold ${group.id === "overdue" ? "text-destructive" : "text-foreground"}`}>
                  {t(`tasksPage.group.${group.id}`)}
                  <span className="font-normal tabular-nums text-muted-foreground">{formatNumber(group.items.length)}</span>
                </h2>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4 shadow-sm">
                  {group.items.map(item => {
                    const itemCourse = item.courseId !== null ? courseById.get(item.courseId) : undefined;
                    const href = item.atSeconds !== null ? `/recording/${item.recordingId}?t=${item.atSeconds}` : `/recording/${item.recordingId}`;
                    return (
                      <TaskItem
                        key={item.id}
                        item={item}
                        today={today}
                        onChanged={() => void refresh()}
                        context={
                          <Link href={href} className="inline-flex min-w-0 max-w-full items-center gap-1.5 underline-offset-2 hover:text-foreground hover:underline">
                            {itemCourse && <CourseDot color={itemCourse.color} />}
                            <span className="truncate">{item.recordingTitle}</span>
                          </Link>
                        }
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
