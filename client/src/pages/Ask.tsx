import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { formatTimestamp } from "@shared/timestamp";

type Citation = { n: number; recordingId: number; title: string; start: number | null; snippet: string };
type AnswerMeta = { citations: Citation[]; searched: number };

/** Where a citation opens: the recording, seeked to the moment when the transcript has timestamps. */
function citationHref(citation: Citation): string {
  return citation.start === null ? `/recording/${citation.recordingId}` : `/recording/${citation.recordingId}?t=${Math.floor(citation.start)}`;
}

function SourceChips({ meta }: { meta: AnswerMeta }) {
  return (
    <div className="space-y-2">
      {meta.citations.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Sources">
          {meta.citations.map(citation => {
            const at = formatTimestamp(citation.start);
            return (
              <li key={citation.n} className="min-w-0 max-w-full">
                <Link
                  href={citationHref(citation)}
                  title={citation.snippet}
                  className="group flex max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-xs transition-colors hover:border-primary/50 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">{citation.n}</span>
                  <span className="truncate font-medium text-foreground">{citation.title}</span>
                  {at && <span className="shrink-0 tabular-nums text-muted-foreground">{at}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {meta.searched === 0 ? "No finished transcripts matched." : `Looked through ${meta.searched} recording${meta.searched === 1 ? "" : "s"}.`}
      </p>
    </div>
  );
}

export default function Ask() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const courseParam = new URLSearchParams(search).get("course");
  const courseId = courseParam && /^\d+$/.test(courseParam) ? Number.parseInt(courseParam, 10) : undefined;

  const { data: courses } = trpc.courses.list.useQuery();
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<Record<number, AnswerMeta>>({});

  const selected = courses?.find(course => course.id === courseId);
  // The answer lands after the question was added, so its index is the current length.
  const answerIndex = useRef(0);
  answerIndex.current = messages.length;

  const ask = trpc.ai.askAcrossRecordings.useMutation({
    onSuccess: result => {
      setMeta(current => ({ ...current, [answerIndex.current]: { citations: result.citations, searched: result.searched } }));
      setMessages(previous => [...previous, { role: "assistant", content: result.answer }]);
    },
    onError: error => toast.error(error.message || "The assistant could not answer. Try again."),
  });

  const send = (question: string) => {
    const history = messages.slice(-6).map(message => ({ role: message.role as "user" | "assistant", content: message.content }));
    setMessages(previous => [...previous, { role: "user", content: question }]);
    ask.mutate({ question, courseId: selected?.id, history });
  };

  const changeCourse = (value: string) => {
    navigate(value === "all" ? "/ask" : `/ask?course=${value}`, { replace: true });
  };

  const emptyMessage = useMemo(
    () =>
      selected
        ? `Ask about anything said in ${selected.name}. Each answer links to the moment it came from.`
        : "Ask about anything said in your recordings. Each answer links to the moment it came from.",
    [selected],
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Library
            </Button>
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Ask StudyScribe</h1>
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-10 pt-8" tabIndex={-1}>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">Search by asking</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              Questions are answered from your own transcripts, across every lecture and meeting at once.
            </p>
          </div>
          <div className="w-full sm:w-60">
            <label htmlFor="ask-course" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Look in
            </label>
            <Select value={selected ? String(selected.id) : "all"} onValueChange={changeCourse}>
              <SelectTrigger id="ask-course" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All recordings</SelectItem>
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

        <AIChatBox
          messages={messages}
          onSendMessage={send}
          isLoading={ask.isPending}
          height="max(26rem, calc(100dvh - 17rem))"
          placeholder={selected ? `Ask about ${selected.name}…` : "What did we cover about…"}
          emptyStateMessage={emptyMessage}
          renderMessageExtra={(message, index) => (message.role === "assistant" && meta[index] ? <SourceChips meta={meta[index]} /> : null)}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Only finished transcripts are searched. Check the linked moment before relying on an answer.
        </p>
      </main>
    </div>
  );
}
