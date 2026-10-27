import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, FileSearch, Flag, MessageSquareText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseDot } from "@/components/CourseDot";
import { PasteNotesDialog } from "@/components/sources/PasteNotesDialog";
import { SourceCard } from "@/components/sources/SourceCard";
import { SourceUploader } from "@/components/sources/SourceUploader";
import { useSourceUploads } from "@/hooks/useSourceUploads";
import { countByScope, fileScopeParam, filterFiles, matchesScope, parseFileScope, resolveScope, uploadCourseFor, type FileScope } from "@/lib/sourceFiles";
import { pollIntervalFor } from "@/lib/sourceUpload";
import type { SourceSummary } from "@/lib/sourceModel";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { MAX_SOURCES_PER_COURSE, MAX_SOURCES_PER_USER } from "@shared/const";

const ALL = "all";
const UNFILED = "unfiled";

/**
 * Files: the person's PDFs, slides, Word documents and notes, with or without a course.
 * It is the study sources feature without the course in front of it.
 */
export default function Files() {
  const { t, tn, formatNumber } = useI18n();
  const search = useSearch();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [pasting, setPasting] = useState(false);
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const watchStart = useRef(Date.now());
  const previous = useRef(new Map<number, string>());
  const finished = useRef(new Set<string>());

  const coursesQuery = trpc.courses.list.useQuery();
  const courses = useMemo(() => (coursesQuery.data ?? []).filter(course => !course.archived), [coursesQuery.data]);
  const courseById = useMemo(() => new Map((coursesQuery.data ?? []).map(course => [course.id, course])), [coursesQuery.data]);

  const requested = parseFileScope(new URLSearchParams(search).get("course"));
  const scope: FileScope = coursesQuery.data ? resolveScope(requested, courses.map(course => course.id)) : requested;

  const list = trpc.sources.list.useQuery(undefined, {
    refetchInterval: result => pollIntervalFor(result.state.data?.sources.map(source => source.status) ?? [], Date.now() - watchStart.current),
  });
  const uploads = useSourceUploads();
  const remove = trpc.sources.remove.useMutation();

  const all = (list.data?.sources ?? []) as SourceSummary[];
  const available = list.data?.available ?? true;
  const counts = useMemo(() => countByScope(all), [all]);
  const shown = useMemo(() => filterFiles(all, scope, query), [all, scope, query]);

  const rows = useMemo(
    () => uploads.rows.filter(row => row.stage !== "done" && matchesScope({ courseId: row.courseId }, scope)),
    [uploads.rows, scope],
  );
  const drivenIds = useMemo(() => new Set(uploads.rows.filter(row => row.sourceId !== null && row.stage !== "error").map(row => row.sourceId as number)), [uploads.rows]);
  const visible = shown.filter(source => !drivenIds.has(source.id) || source.status === "ready");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const source of all) {
      const before = previous.current.get(source.id);
      if (before && before !== "ready" && source.status === "ready") setAnnouncement(t("sources.announce.ready", { name: source.title }));
      previous.current.set(source.id, source.status);
    }
  }, [all, t]);

  useEffect(() => {
    for (const row of uploads.rows) {
      if (row.stage === "done" && !finished.current.has(row.id)) {
        finished.current.add(row.id);
        setAnnouncement(t("sources.announce.ready", { name: row.name }));
      }
    }
  }, [uploads.rows, t]);

  const uploadCourse = uploadCourseFor(scope);
  const userFull = all.length >= MAX_SOURCES_PER_USER;
  const courseFull = uploadCourse !== null && (counts.byCourse.get(uploadCourse) ?? 0) >= MAX_SOURCES_PER_COURSE;

  const changeScope = (value: string) => {
    const next: FileScope = value === ALL ? "all" : value === UNFILED ? "unfiled" : Number.parseInt(value, 10);
    const param = fileScopeParam(next);
    navigate(param ? `/files?course=${param}` : "/files", { replace: true });
  };

  const onDelete = async (source: SourceSummary) => {
    try {
      await remove.mutateAsync({ id: source.id });
      await Promise.all([utils.sources.list.invalidate(), utils.sources.get.invalidate()]);
      toast.success(t("sources.delete.done"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sources.error.failed"));
    }
  };

  const scopeValue = scope === "all" ? ALL : scope === "unfiled" ? UNFILED : String(scope);
  const scopeName = scope === "all" ? t("files.filter.all") : scope === "unfiled" ? t("files.filter.unfiled") : (courseById.get(scope)?.name ?? "");
  const uploadCourseName = uploadCourse !== null ? courseById.get(uploadCourse)?.name : undefined;
  const destination = uploadCourse === null ? t("files.upload.unfiled") : uploadCourseName ? t("files.upload.intoCourse", { course: uploadCourseName }) : t("files.upload.resolving");
  const hasFiles = all.length > 0 || uploads.rows.some(row => row.stage !== "done");
  const filtering = scope !== "all" || query.trim() !== "";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t("common.library")}</span>
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-8" tabIndex={-1}>
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{t("files.title")}</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{t("files.subtitle")}</p>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {!available ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p>{t("files.notSetUp")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {userFull ? (
              <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">{t("files.upload.userFull", { max: MAX_SOURCES_PER_USER })}</p>
            ) : courseFull ? (
              <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">{t("sources.upload.courseFull", { max: MAX_SOURCES_PER_COURSE })}</p>
            ) : (
              <div className="space-y-2">
                <SourceUploader
                  rows={rows}
                  compact={hasFiles}
                  onFiles={files => uploads.addFiles(files, uploadCourse)}
                  onPaste={() => setPasting(true)}
                  onRetry={uploads.retry}
                  onRemove={uploads.remove}
                />
                <p className="px-1 text-xs text-muted-foreground">{destination}</p>
              </div>
            )}

            {list.isLoading ? (
              <ul className="space-y-3" aria-label={t("common.loading")}>
                {[0, 1, 2].map(index => (
                  <li key={index}>
                    <Skeleton className="h-28 w-full rounded-2xl" />
                  </li>
                ))}
              </ul>
            ) : list.isError ? (
              <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm">
                <p className="text-destructive">{t("sources.error.loadList")}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
                  {t("sources.retry")}
                </Button>
              </div>
            ) : all.length === 0 ? (
              rows.length === 0 && <FilesEmpty />
            ) : (
              <section aria-labelledby="files-list-heading" className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="sm:w-60">
                    <label htmlFor="files-scope" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("files.filter.label")}
                    </label>
                    <Select value={scopeValue} onValueChange={changeScope}>
                      <SelectTrigger id="files-scope" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>{t("files.filter.allCount", { count: formatNumber(counts.all) })}</SelectItem>
                        <SelectItem value={UNFILED}>{t("files.filter.unfiledCount", { count: formatNumber(counts.unfiled) })}</SelectItem>
                        {courses.map(course => (
                          <SelectItem key={course.id} value={String(course.id)}>
                            <span className="flex items-center gap-2">
                              <CourseDot color={course.color} className="size-2" />
                              {course.name} ({formatNumber(counts.byCourse.get(course.id) ?? 0)})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <label htmlFor="files-search" className="sr-only">
                      {t("files.search.label")}
                    </label>
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input id="files-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("files.search.placeholder")} className="pl-9" />
                  </div>
                </div>

                <h2 id="files-list-heading" className="text-sm font-medium text-muted-foreground">
                  {filtering ? tn("files.showing", visible.length, { scope: scopeName }) : tn("files.count", all.length, { max: MAX_SOURCES_PER_USER })}
                </h2>

                {visible.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
                    <p className="text-sm font-medium">{t("files.noMatch.title")}</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("files.noMatch.body")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        setQuery("");
                        changeScope(ALL);
                      }}
                    >
                      {t("files.noMatch.clear")}
                    </Button>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {visible.map(source => {
                      const course = source.courseId === null ? null : courseById.get(source.courseId);
                      return (
                        <SourceCard
                          key={source.id}
                          source={source}
                          now={now}
                          driven={drivenIds.has(source.id)}
                          course={course ? { name: course.name, color: course.color } : null}
                          movable
                          onContinue={item => uploads.resume(item)}
                          onRetry={item => uploads.resume(item)}
                          onDelete={item => void onDelete(item)}
                          deleting={remove.isPending}
                        />
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      <PasteNotesDialog open={pasting} onOpenChange={setPasting} onSubmit={(title, text) => uploads.addNotes(title, text, uploadCourse)} />
    </div>
  );
}

function FilesEmpty() {
  const { t } = useI18n();
  const steps = [
    { icon: FileSearch, title: t("files.empty.summaryTitle"), body: t("files.empty.summaryBody") },
    { icon: Flag, title: t("files.empty.flagsTitle"), body: t("files.empty.flagsBody") },
    { icon: MessageSquareText, title: t("files.empty.askTitle"), body: t("files.empty.askBody") },
  ];
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-8 sm:px-8">
      <h2 className="text-lg font-semibold">{t("files.empty.title")}</h2>
      <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{t("files.empty.body")}</p>
      <ul className="mt-5 space-y-4">
        {steps.map(step => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-mist text-primary" aria-hidden="true">
              <step.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
