import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseDot } from "@/components/CourseDot";
import { PasteNotesDialog } from "@/components/sources/PasteNotesDialog";
import { SourceCard } from "@/components/sources/SourceCard";
import { SourceUploader } from "@/components/sources/SourceUploader";
import { useSourceUploads } from "@/hooks/useSourceUploads";
import { pollIntervalFor } from "@/lib/sourceUpload";
import type { SourceSummary } from "@/lib/sourceModel";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { MAX_SOURCES_PER_COURSE } from "@shared/const";

export default function SourceLibrary() {
  const { t, tn } = useI18n();
  const [, params] = useRoute("/courses/:id/sources");
  const courseId = params?.id ? Number.parseInt(params.id, 10) : NaN;
  const validId = Number.isInteger(courseId) && courseId > 0;
  const utils = trpc.useUtils();
  const [pasting, setPasting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const watchStart = useRef(Date.now());
  const previous = useRef(new Map<number, string>());

  const { data: course, isLoading: courseLoading } = trpc.courses.get.useQuery({ id: courseId }, { enabled: validId, retry: false });
  const list = trpc.sources.list.useQuery(
    { courseId },
    {
      enabled: validId,
      refetchInterval: query => pollIntervalFor(query.state.data?.sources.map(source => source.status) ?? [], Date.now() - watchStart.current),
    },
  );
  const uploads = useSourceUploads();
  const rows = useMemo(() => uploads.rows.filter(row => row.courseId === (validId ? courseId : null)), [uploads.rows, validId, courseId]);
  const remove = trpc.sources.remove.useMutation();

  const sources = (list.data?.sources ?? []) as SourceSummary[];
  const available = list.data?.available ?? true;
  const drivenIds = useMemo(() => new Set(rows.filter(row => row.sourceId !== null && row.stage !== "error").map(row => row.sourceId as number)), [rows]);
  const visibleSources = sources.filter(source => !drivenIds.has(source.id) || source.status === "ready");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Tell screen reader users when a source becomes ready (one polite region for the page).
  useEffect(() => {
    for (const source of sources) {
      const before = previous.current.get(source.id);
      if (before && before !== "ready" && source.status === "ready") setAnnouncement(t("sources.announce.ready", { name: source.title }));
      previous.current.set(source.id, source.status);
    }
  }, [sources, t]);

  const finished = useRef(new Set<string>());
  useEffect(() => {
    for (const row of rows) {
      if (row.stage === "done" && !finished.current.has(row.id)) {
        finished.current.add(row.id);
        setAnnouncement(t("sources.announce.ready", { name: row.name }));
      }
    }
  }, [rows, t]);

  const full = sources.length >= MAX_SOURCES_PER_COURSE;
  const refresh = () => Promise.all([utils.sources.list.invalidate(), utils.sources.get.invalidate()]);

  // Retrying a failed source resets it on the server first, then reads it again.
  const onRetry = (source: SourceSummary) => uploads.resume(source);

  const onDelete = async (source: SourceSummary) => {
    try {
      await remove.mutateAsync({ id: source.id });
      await refresh();
      toast.success(t("sources.delete.done"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sources.error.failed"));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href={validId ? `/courses/${courseId}` : "/dashboard"}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{course ? course.name : t("common.library")}</span>
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-8" tabIndex={-1}>
        {courseLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-accent" aria-label={t("common.loading")} />
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
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2.5 text-sm text-muted-foreground">
                <CourseDot color={course.color} className="size-2.5" />
                <span>{course.name}</span>
              </div>
              <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{t("sources.title")}</h1>
              <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{t("sources.subtitle")}</p>
              <Link href={`/files?course=${courseId}`} className="mt-2 inline-block text-sm font-medium text-primary underline underline-offset-2">
                {t("files.allFilesLink")}
              </Link>
            </div>

            <p role="status" aria-live="polite" className="sr-only">
              {announcement}
            </p>

            {!available ? (
              <div role="alert" className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p>{t("sources.error.notSetUp")}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {full ? (
                  <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">{t("sources.upload.courseFull", { max: MAX_SOURCES_PER_COURSE })}</p>
                ) : (
                  <SourceUploader
                    rows={rows.filter(row => row.stage !== "done")}
                    compact={sources.length > 0}
                    onFiles={files => uploads.addFiles(files, validId ? courseId : null)}
                    onPaste={() => setPasting(true)}
                    onRetry={uploads.retry}
                    onRemove={uploads.remove}
                  />
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
                ) : visibleSources.length === 0 && rows.filter(row => row.stage !== "done").length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                    <h2 className="text-lg font-semibold">{t("sources.empty.title")}</h2>
                    <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{t("sources.empty.body")}</p>
                  </div>
                ) : (
                  <section aria-labelledby="sources-list-heading">
                    <h2 id="sources-list-heading" className="mb-3 text-sm font-medium text-muted-foreground">
                      {tn("sources.count", sources.length, { max: MAX_SOURCES_PER_COURSE })}
                    </h2>
                    <ul className="space-y-3">
                      {visibleSources.map(source => (
                        <SourceCard
                          key={source.id}
                          source={source}
                          now={now}
                          driven={drivenIds.has(source.id)}
                          onContinue={item => uploads.resume(item)}
                          onRetry={item => onRetry(item)}
                          onDelete={item => void onDelete(item)}
                          deleting={remove.isPending}
                        />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <PasteNotesDialog open={pasting} onOpenChange={setPasting} onSubmit={(title, text) => uploads.addNotes(title, text, validId ? courseId : null)} />
    </div>
  );
}
