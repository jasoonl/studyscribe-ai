import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

/** Notes written without a recording: search, filter by course, start a new one. */
export default function Notes() {
  const { t, formatDate } = useI18n();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState("all");
  const trimmed = search.trim();
  const courseId = course === "all" || course === "none" ? undefined : Number(course);
  const { data, isLoading, isError } = trpc.notePages.list.useQuery({ courseId, search: trimmed || undefined }, { placeholderData: previous => previous });
  const { data: courses } = trpc.courses.list.useQuery();
  const courseById = new Map((courses ?? []).map(entry => [entry.id, entry]));
  const create = trpc.notePages.create.useMutation({
    onSuccess: ({ id }) => navigate(`/notes/${id}`),
    onError: error => toast.error(error.message || t("notes.createFailed")),
  });

  const notes = (data?.notes ?? []).filter(note => course !== "none" || note.courseId === null);
  const unavailable = data !== undefined && !data.available;
  const filtering = trimmed !== "" || course !== "all";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("common.library")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.03em] text-foreground">{t("notes.title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("notes.subtitle")}</p>
          </div>
          {!unavailable && (
            <Button onClick={() => create.mutate({ courseId: courseId ?? null })} disabled={create.isPending} className="self-start">
              {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
              {t("notes.new")}
            </Button>
          )}
        </div>

        {unavailable ? (
          <p role="status" className="rounded-lg border border-border bg-card p-6 text-muted-foreground">{t("notes.notSetUp")}</p>
        ) : (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-[1fr_14rem]">
              <div className="space-y-1.5">
                <Label htmlFor="notes-search">{t("notes.searchLabel")}</Label>
                <Input id="notes-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("notes.searchPlaceholder")} maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes-course">{t("notes.courseFilter")}</Label>
                <Select value={course} onValueChange={setCourse}>
                  <SelectTrigger id="notes-course" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("notes.allCourses")}</SelectItem>
                    <SelectItem value="none">{t("notes.unfiled")}</SelectItem>
                    {(courses ?? []).filter(entry => !entry.archived).map(entry => (
                      <SelectItem key={entry.id} value={String(entry.id)}>
                        <span className="flex items-center gap-2"><CourseDot color={entry.color} className="size-2" />{entry.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16" role="status" aria-label={t("common.loading")}>
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : isError ? (
              <p role="alert" className="text-destructive">{t("notes.loadFailed")}</p>
            ) : notes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center">
                <h2 className="text-lg font-semibold text-foreground">{filtering ? t("notes.noMatch") : t("notes.emptyTitle")}</h2>
                {!filtering && <p className="mx-auto mt-2 max-w-md text-muted-foreground">{t("notes.emptyBody")}</p>}
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {notes.map(note => {
                  const noteCourse = note.courseId !== null ? courseById.get(note.courseId) : undefined;
                  return (
                    <li key={note.id}>
                      <Link href={`/notes/${note.id}`} className="block px-4 py-3.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <span className="block truncate font-medium text-foreground">{note.title || t("notes.untitled")}</span>
                        {note.preview && <span className="mt-0.5 block truncate text-sm text-muted-foreground">{note.preview}</span>}
                        <span className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          {noteCourse && <span className="flex items-center gap-1.5"><CourseDot color={noteCourse.color} className="size-2" />{noteCourse.name}</span>}
                          <span>{t("notes.updated", { date: formatDate(note.updatedAt, { dateStyle: "medium" }) })}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
