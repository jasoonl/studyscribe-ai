import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { CitationChips, type AnswerMeta } from "@/components/sources/CitationChips";
import { Skeleton } from "@/components/ui/skeleton";
import { SourcePicker } from "@/components/sources/SourcePicker";
import { askHref, askRequestOptions, parseAskSources, type AskSourceSelection } from "@/lib/askSources";
import { useI18n } from "@/i18n";

/**
 * Smart search (C2) status under the chat: how much of the library has been
 * embedded, and a button that indexes the rest in small server-sized batches.
 */
function SmartSearchStatus() {
  const { t, tn, formatNumber } = useI18n();
  const utils = trpc.useUtils();
  const { data: status } = trpc.smartSearch.status.useQuery();
  const [running, setRunning] = useState(false);
  const indexNext = trpc.smartSearch.indexNext.useMutation();

  if (!status) return null;
  if (!status.configured || !status.available) {
    return <p className="text-xs text-muted-foreground">{t("ask.smartOff")}</p>;
  }
  const missing = status.total - status.indexed;

  const run = async () => {
    setRunning(true);
    try {
      for (let round = 0; round < 30; round++) {
        const result = await indexNext.mutateAsync();
        await utils.smartSearch.status.invalidate();
        if (result.failed) throw new Error(result.failed);
        if (result.remaining <= 0 || result.indexed === 0) break;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ask.indexStopped"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
      <span>
        {tn("ask.smartOn", status.total, { indexed: formatNumber(status.indexed) })}
      </span>
      {missing > 0 && (
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={running} onClick={run}>
          {running ? t("ask.indexing") : t("ask.indexOther", { count: formatNumber(missing) })}
        </Button>
      )}
    </div>
  );
}

export default function Ask() {
  const { t, language } = useI18n();
  const search = useSearch();
  const [, navigate] = useLocation();
  const courseParam = new URLSearchParams(search).get("course");
  const courseId = courseParam && /^\d+$/.test(courseParam) ? Number.parseInt(courseParam, 10) : undefined;

  const sourceList = trpc.sources.list.useQuery({ courseId: courseId }, { retry: false });
  const sourceCount = sourceList.data?.available ? sourceList.data.sources.length : 0;
  const readySources = sourceList.data?.available ? sourceList.data.sources.filter(source => source.status === "ready").length : 0;
  const selection = useMemo(() => parseAskSources(search), [search]);
  const { data: courses } = trpc.courses.list.useQuery();
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<Record<number, AnswerMeta>>({});

  const selected = courses?.find(course => course.id === courseId);
  // The answer lands after the question was added, so its index is the current length.
  const answerIndex = useRef(0);
  answerIndex.current = messages.length;

  const ask = trpc.ai.askAcrossRecordings.useMutation({
    onSuccess: result => {
      setMeta(current => ({
        ...current,
        [answerIndex.current]: { citations: result.citations, searched: result.searched, searchedSources: result.searchedSources, retrieval: result.retrieval, askedSources: askedSources.current, askedRecordings: askedRecordings.current },
      }));
      setMessages(previous => [...previous, { role: "assistant", content: result.answer }]);
    },
    onError: error => toast.error(error.message || t("ask.failed")),
  });

  const askedSources = useRef(true);
  const askedRecordings = useRef(true);

  const send = (question: string) => {
    const options = askRequestOptions(selection);
    askedSources.current = options.includeSources && readySources > 0;
    askedRecordings.current = options.includeRecordings;
    const history = messages.slice(-6).map(message => ({ role: message.role as "user" | "assistant", content: message.content }));
    setMessages(previous => [...previous, { role: "user", content: question }]);
    ask.mutate({ question, courseId: selected?.id, history, ...options });
  };

  const changeCourse = (value: string) => {
    // Sources belong to a course, so a new course starts with all of its sources.
    navigate(askHref(value === "all" ? undefined : Number.parseInt(value, 10), { ids: [], mode: selection.mode }), { replace: true });
  };

  const changeSelection = (next: AskSourceSelection) => navigate(askHref(selected?.id, next), { replace: true });

  const emptyMessage = useMemo(
    () =>
      selected
        ? t("ask.emptyCourse", { course: selected.name })
        : t("ask.empty"),
    [selected, language],
  );

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
          <h1 className="text-xl font-bold tracking-tight">{t("library.ask")}</h1>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-10 pt-8" tabIndex={-1}>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{t("ask.heading")}</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              {t("ask.subtitle")}
            </p>
          </div>
          <div className="w-full sm:w-60">
            <label htmlFor="ask-course" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("ask.lookIn")}
            </label>
            <Select value={selected ? String(selected.id) : "all"} onValueChange={changeCourse}>
              <SelectTrigger id="ask-course" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ask.allRecordings")}</SelectItem>
                {courses?.map(course => (
                  <SelectItem key={course.id} value={String(course.id)}>
                    <span className="flex items-center gap-2">
                      <CourseDot color={course.color} />
                      {course.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {sourceCount > 0 && (
          <div className="mb-4 sm:max-w-sm">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ask.sources.label")}</span>
            {courseId !== undefined && !courses ? (
              <Skeleton className="h-10 w-full" aria-label={t("common.loading")} />
            ) : (
              <SourcePicker courseId={selected?.id} selection={selection} onChange={changeSelection} />
            )}
          </div>
        )}

        <AIChatBox
          messages={messages}
          onSendMessage={send}
          isLoading={ask.isPending}
          height="max(26rem, calc(100dvh - 17rem))"
          placeholder={selected ? t("ask.placeholderCourse", { course: selected.name }) : t("ask.placeholder")}
          emptyStateMessage={emptyMessage}
          renderMessageExtra={(message, index) => (message.role === "assistant" && meta[index] ? <CitationChips meta={meta[index]} /> : null)}
        />
        <div className="mt-3 space-y-1.5">
          <p className="text-xs text-muted-foreground">{readySources > 0 && selection.mode !== "recordings" ? t("ask.footerSources") : t("ask.footer")}</p>
          <SmartSearchStatus />
        </div>
      </main>
    </div>
  );
}
