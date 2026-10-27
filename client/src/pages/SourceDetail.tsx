import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, FolderInput, MoreHorizontal, Pencil, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Markdown } from "@/components/Markdown";
import { DeleteSourceDialog } from "@/components/sources/DeleteSourceDialog";
import { KeyPointsList } from "@/components/sources/KeyPointsList";
import { MoveSourceDialog } from "@/components/sources/MoveSourceDialog";
import { LocationChip } from "@/components/sources/LocationChip";
import { PassageViewer } from "@/components/sources/PassageViewer";
import { SourceUploadRow } from "@/components/sources/SourceUploadRow";
import { SourceProgress } from "@/components/sources/SourceProgress";
import { SourceStatusBadge } from "@/components/sources/SourceStatusBadge";
import { unitNounKey } from "@/components/sources/SourceCard";
import { useSourceUploads } from "@/hooks/useSourceUploads";
import { formatBytes } from "@/lib/formatBytes";
import { unitFromPageParam } from "@/lib/sourceLocation";
import { failureReasonOf, isRetryableReason, kindLabelKey, stageOf, summaryPercent, type SourceFlag, type SourceSummary } from "@/lib/sourceModel";
import { isStalled } from "@/lib/sourceUpload";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { MAX_SOURCES_PER_COURSE } from "@shared/const";

const TABS = ["summary", "points", "pages"] as const;
type Tab = (typeof TABS)[number];

export default function SourceDetail() {
  const { t, tn, formatDate, formatNumber } = useI18n();
  const [, params] = useRoute("/sources/:id");
  const id = params?.id ? Number.parseInt(params.id, 10) : NaN;
  const validId = Number.isInteger(id) && id > 0;
  const search = useSearch();
  const [, navigate] = useLocation();
  const query = new URLSearchParams(search);
  const utils = trpc.useUtils();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [title, setTitle] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const lastStatus = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const result = trpc.sources.get.useQuery(
    { id },
    {
      enabled: validId,
      retry: false,
      refetchInterval: q => {
        const status = q.state.data?.source.status;
        return status && status !== "ready" && status !== "failed" ? 4000 : false;
      },
    },
  );
  const uploads = useSourceUploads();
  const myRows = uploads.rows.filter(row => row.sourceId === id);
  const driven = myRows.some(row => row.stage !== "error" && row.stage !== "done");
  const update = trpc.sources.update.useMutation();
  const remove = trpc.sources.remove.useMutation();

  const data = result.data;
  const source = data?.source as (SourceSummary & { summary: string | null }) | undefined;
  const flags = (data?.flags ?? []) as SourceFlag[];
  const units = data?.units ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!source) return;
    if (lastStatus.current && lastStatus.current !== "ready" && source.status === "ready") setAnnouncement(t("sources.announce.ready", { name: source.title }));
    lastStatus.current = source.status;
  }, [source, t]);

  const stage = source ? stageOf(source.status) : null;
  const ready = stage === "ready";
  const working = stage === "waiting" || stage === "reading" || stage === "summarizing";

  const tabParam = query.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "summary";
  const pageUnit = unitFromPageParam(query.get("page"), units.length);
  const current = pageUnit !== null ? (units[pageUnit]?.unitIndex ?? 0) : (units[0]?.unitIndex ?? 0);
  const fromLink = query.has("page");

  const go = (next: Record<string, string | null>) => {
    const copy = new URLSearchParams(search);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) copy.delete(key);
      else copy.set(key, value);
    }
    const text = copy.toString();
    navigate(`/sources/${id}${text ? `?${text}` : ""}`, { replace: true });
  };

  const refresh = () => Promise.all([utils.sources.get.invalidate({ id }), utils.sources.list.invalidate()]);

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || update.isPending) return;
    try {
      await update.mutateAsync({ id, title: title.trim() });
      await refresh();
      setRenaming(false);
      toast.success(t("sources.rename.done"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sources.error.failed"));
    }
  };

  const doDelete = async () => {
    try {
      await remove.mutateAsync({ id });
      await utils.sources.list.invalidate();
      toast.success(t("sources.delete.done"));
      navigate(source?.courseId ? `/courses/${source.courseId}/sources` : "/files");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sources.error.failed"));
    }
  };

  const backHref = source?.courseId ? `/courses/${source.courseId}/sources` : "/files";
  const askHref = source ? `/ask?${source.courseId ? `course=${source.courseId}&` : ""}source=${source.id}` : "/ask";
  const topPoints = flags.filter(flag => flag.importance >= 3).slice(0, 5);
  const percent = source ? summaryPercent(source) : null;
  const reason = failureReasonOf(source?.errorMessage, source?.kind);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href={backHref}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{source && !source.courseId ? t("files.title") : t("sources.title")}</span>
            </Button>
          </Link>
          {source && (
            <div className="flex items-center gap-2">
              {ready && (
                <Link href={askHref}>
                  <Button size="sm" className="min-h-10 gap-2">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    {t("sources.detail.ask")}
                  </Button>
                </Link>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="outline" className="size-10" aria-label={t("sources.detail.more")}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setTitle(source.title);
                      setRenaming(true);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    {t("sources.rename.button")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMoving(true)}>
                    <FolderInput className="size-4" aria-hidden="true" />
                    {t("files.move.button")}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t("sources.delete.button")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </header>

      <main id="main-content" className="container max-w-4xl pb-20 pt-8" tabIndex={-1}>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {result.isLoading ? (
          <div className="space-y-4" aria-label={t("common.loading")}>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : !source ? (
          <div className="py-24 text-center">
            <h1 className="mb-2 text-2xl font-bold tracking-tight">{t("sources.detail.notFound")}</h1>
            <p className="mb-6 text-muted-foreground">{t("sources.detail.notFoundHint")}</p>
            <Link href="/files">
              <Button>{t("files.backToFiles")}</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="break-words text-3xl font-bold tracking-[-0.04em] [overflow-wrap:anywhere] sm:text-4xl">{source.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                <SourceStatusBadge status={source.status} />
                <span>
                  {[
                    t(kindLabelKey(source.kind)),
                    source.unitCount > 0 ? tn(unitNounKey(source.kind), source.unitCount) : null,
                    formatBytes(source.sizeBytes, formatNumber),
                    formatDate(source.createdAt, { month: "short", day: "numeric", year: "numeric" }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>

            {working && (
              <div className="mb-6 rounded-2xl border border-border bg-card p-4">
                <SourceProgress
                  percent={stage === "summarizing" ? percent : null}
                  label={t("sources.upload.progressNamed", { name: source.title })}
                  valueText={t(`sources.status.${stage as "waiting" | "reading" | "summarizing"}`)}
                />
                <p className="mt-2 text-sm text-muted-foreground">{!driven && isStalled(source, now) ? t("sources.card.stalled") : t("sources.detail.working")}</p>
                {!driven && isStalled(source, now) && (
                  <Button size="sm" variant="outline" className="mt-3 min-h-9 gap-1.5" onClick={() => uploads.resume(source)}>
                    <RotateCw className="size-3.5" aria-hidden="true" />
                    {t("sources.card.continue")}
                  </Button>
                )}
              </div>
            )}

            {stage === "failed" && (
              <div role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-destructive/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t(`sources.reason.${reason}`, { max: MAX_SOURCES_PER_COURSE })}
                </p>
                {isRetryableReason(reason) && !driven && (
                  <Button size="sm" variant="outline" className="min-h-9 gap-1.5 self-start" onClick={() => uploads.resume(source)}>
                    <RotateCw className="size-3.5" aria-hidden="true" />
                    {t("sources.upload.retry")}
                  </Button>
                )}
              </div>
            )}

            {myRows.some(row => row.stage === "error") && (
              <ul className="mb-6 space-y-2" aria-label={t("sources.upload.listLabel")}>
                {myRows
                  .filter(row => row.stage === "error")
                  .map(row => (
                    <SourceUploadRow key={row.id} row={row} onRetry={uploads.retry} onRemove={uploads.remove} />
                  ))}
              </ul>
            )}

            {ready && (
              <Tabs value={tab} onValueChange={value => go({ tab: value, ...(value === "pages" ? {} : { page: null, q: null }) })} className="gap-5">
                <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                  <TabsList className="w-max">
                    <TabsTrigger value="summary" className="px-4">
                      {t("sources.detail.tabSummary")}
                    </TabsTrigger>
                    <TabsTrigger value="points" className="px-4">
                      {t("sources.detail.tabPoints")}
                    </TabsTrigger>
                    <TabsTrigger value="pages" className="px-4">
                      {t(source.kind === "pptx" ? "sources.detail.tabSlides" : source.kind === "pdf" ? "sources.detail.tabPages" : "sources.detail.tabSections")}
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="summary" className="space-y-6">
                  {source.summary?.trim() ? (
                    <div className="prose-sm max-w-none rounded-2xl border border-border bg-card p-5 text-base leading-relaxed">
                      <Markdown>{source.summary}</Markdown>
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">{t("sources.detail.noSummary")}</p>
                  )}
                  {topPoints.length > 0 && (
                    <section aria-labelledby="top-points">
                      <h2 id="top-points" className="mb-3 text-lg font-semibold tracking-tight">
                        {t("sources.detail.topPoints")}
                      </h2>
                      <ul className="space-y-2.5">
                        {topPoints.map(flag => (
                          <li key={flag.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-start sm:justify-between">
                            <p className="min-w-0 text-sm leading-relaxed">{flag.text}</p>
                            <div className="shrink-0">
                              <LocationChip sourceId={source.id} unitIndex={flag.unitIndex} label={flag.label} quote={flag.quote} />
                            </div>
                          </li>
                        ))}
                      </ul>
                      <Button variant="link" className="mt-2 h-auto px-0" onClick={() => go({ tab: "points", page: null, q: null })}>
                        {t("sources.detail.seeAllPoints")}
                      </Button>
                    </section>
                  )}
                </TabsContent>

                <TabsContent value="points">
                  <KeyPointsList sourceId={source.id} flags={flags} />
                </TabsContent>

                <TabsContent value="pages">
                  {units.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">{t("sources.pages.none")}</p>
                  ) : (
                    <PassageViewer
                      sourceId={source.id}
                      units={units}
                      current={current}
                      quote={query.get("q")}
                      focusHeading={fromLink}
                      onSelect={unitIndex => go({ tab: "pages", page: String(unitIndex + 1), q: null })}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </main>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={rename} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t("sources.rename.title")}</DialogTitle>
              <DialogDescription>{t("sources.rename.description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="source-title">{t("sources.paste.nameLabel")}</Label>
              <Input id="source-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
                {t("sources.paste.cancel")}
              </Button>
              <Button type="submit" disabled={!title.trim() || update.isPending}>
                {t("sources.rename.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {source && <MoveSourceDialog source={source} open={moving} onOpenChange={setMoving} />}
      {source && <DeleteSourceDialog title={source.title} open={deleting} onOpenChange={setDeleting} pending={remove.isPending} onConfirm={() => void doDelete()} />}
    </div>
  );
}
