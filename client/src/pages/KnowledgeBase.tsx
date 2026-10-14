import { useState, useCallback } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Clock, ArrowLeft, FileText, Loader2, X } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { formatRecordingDuration } from "@/lib/formatDuration";
import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";
import { cn } from "@/lib/utils";

type SearchMode = "keyword" | "smart";
const MODE_KEY = "studyscribe_kb_mode";

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "Unknown date";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function highlightMatch(text: string, query: string) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-annotation px-0.5 text-foreground">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function readMode(): SearchMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "smart" ? "smart" : "keyword";
  } catch {
    return "keyword";
  }
}

/**
 * Knowledge Base: keyword search over titles and transcripts, plus smart
 * search (by meaning, through the embeddings index) when the server has
 * embeddings configured. Smart results link to the moment in the recording.
 */
export default function KnowledgeBase() {
  const [inputValue, setInputValue] = useState("");
  const [preferredMode, setPreferredMode] = useState<SearchMode>(readMode);
  const debouncedQuery = useDebounce(inputValue, 400);
  const utils = trpc.useUtils();

  const { data: smartStatus } = trpc.smartSearch.status.useQuery(undefined, { staleTime: 60_000 });
  const smartAvailable = Boolean(smartStatus?.configured && smartStatus.available);
  const mode: SearchMode = smartAvailable ? preferredMode : "keyword";
  const query = debouncedQuery.trim();
  const hasQuery = query.length >= 2;

  const keyword = trpc.knowledgeBase.search.useQuery({ query }, { enabled: hasQuery && mode === "keyword" });
  const smart = trpc.smartSearch.search.useQuery({ query }, { enabled: hasQuery && mode === "smart", retry: false, staleTime: 5 * 60_000 });
  const indexNext = trpc.smartSearch.indexNext.useMutation({
    onSuccess: async result => {
      await utils.smartSearch.status.invalidate();
      if (result.failed) toast.error(result.failed);
      else toast.success(result.remaining > 0 ? `Indexed ${result.indexed}. ${result.remaining} to go.` : "Every transcript is indexed.");
    },
    onError: error => toast.error(error.message || "Could not index right now"),
  });

  const setMode = (next: SearchMode) => {
    setPreferredMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // A blocked storage only means the choice is not remembered.
    }
  };

  const handleClear = useCallback(() => setInputValue(""), []);
  const active = mode === "smart" ? smart : keyword;
  const showLoading = hasQuery && (active.isLoading || active.isFetching);
  const unindexed = smartStatus ? Math.max(0, smartStatus.total - smartStatus.indexed) : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Library
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground">Knowledge Base</h1>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-8 focus:outline-none">
        <div className="mb-8 text-center">
          <h2 className="mb-2 text-2xl font-bold text-foreground">Search your transcripts</h2>
          <p className="text-sm text-muted-foreground">
            {mode === "smart" ? "Smart search finds passages by meaning, even when the words differ." : "Search across all your recordings and transcripts in one place."}
          </p>
        </div>

        {smartAvailable && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5" role="group" aria-label="Search mode">
              {(["keyword", "smart"] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mode === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option === "keyword" ? "Keywords" : "Smart search"}
                </button>
              ))}
            </div>
            {mode === "smart" && smartStatus && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {smartStatus.indexed} of {smartStatus.total} transcript{smartStatus.total === 1 ? "" : "s"} indexed
                </span>
                {unindexed > 0 && (
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={indexNext.isPending} onClick={() => indexNext.mutate()}>
                    {indexNext.isPending ? "Indexing…" : "Index the rest"}
                  </Button>
                )}
              </p>
            )}
          </div>
        )}

        <div className="relative mb-8">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={mode === "smart" ? "Ask in your own words, e.g. how cells make energy" : "Search recordings, topics, keywords"}
            aria-label={mode === "smart" ? "Smart search" : "Search transcripts"}
            className="h-12 rounded-xl border-2 pl-12 pr-12 text-base shadow-sm focus-visible:border-primary"
            autoFocus
          />
          {inputValue && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div aria-live="polite" aria-busy={showLoading}>
          {!hasQuery && (
            <div className="py-16 text-center text-muted-foreground">
              <Search className="mx-auto mb-4 h-12 w-12 opacity-30" aria-hidden="true" />
              <p className="text-base font-medium">Type at least 2 characters to search</p>
              <p className="mt-1 text-sm">Your recordings and transcripts will appear here</p>
            </div>
          )}

          {showLoading && (
            <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span>Searching…</span>
            </div>
          )}

          {hasQuery && !showLoading && active.error && (
            <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
              <p className="font-medium">{active.error.message}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void active.refetch()}>
                  Try again
                </Button>
                {mode === "smart" && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setMode("keyword")}>
                    Use keyword search
                  </Button>
                )}
              </div>
            </div>
          )}

          {hasQuery && !showLoading && !active.error && mode === "keyword" && keyword.data && (
            keyword.data.length === 0 ? (
              <EmptyResults query={query} smartAvailable={smartAvailable} onSmart={() => setMode("smart")} />
            ) : (
              <div className="space-y-3">
                <p className="mb-4 text-sm text-muted-foreground">
                  {keyword.data.length} result{keyword.data.length !== 1 ? "s" : ""} for <span className="font-medium text-foreground">"{query}"</span>
                </p>
                {keyword.data.map(result => (
                  <Link key={result.recordingId} href={`/recording/${result.recordingId}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="group cursor-pointer transition-shadow duration-150 hover:border-primary hover:shadow-md">
                      <CardContent className="p-3 sm:p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                              <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary sm:text-base">{result.recordingTitle}</h3>
                            </div>
                            {result.snippet ? (
                              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">{highlightMatch(result.snippet, query)}</p>
                            ) : (
                              <p className="text-xs italic text-muted-foreground sm:text-sm">Title match. Open it to see the transcript.</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
                            <Badge variant={result.transcriptStatus === "completed" ? "default" : "secondary"} className="text-xs">
                              {result.transcriptStatus ?? "pending"}
                            </Badge>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {formatRecordingDuration(result.recordingDuration)}
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(result.recordingCreatedAt)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )
          )}

          {hasQuery && !showLoading && !active.error && mode === "smart" && smart.data && (
            smart.data.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <FileText className="mx-auto mb-4 h-12 w-12 opacity-30" aria-hidden="true" />
                <p className="text-base font-medium">{smartStatus && smartStatus.indexed === 0 ? "Nothing is indexed for smart search yet" : `Nothing close to "${query}"`}</p>
                <p className="mt-1 text-sm">{smartStatus && smartStatus.indexed === 0 ? "Index your transcripts above, then search again." : "Try describing it another way, or use keywords."}</p>
              </div>
            ) : (
              <ol className="space-y-3">
                {smart.data.map(result => (
                  <li key={`${result.recordingId}-${result.start ?? 0}-${result.text.slice(0, 12)}`}>
                    <Link
                      href={result.start !== null ? `/recording/${result.recordingId}?t=${Math.floor(result.start)}` : `/recording/${result.recordingId}`}
                      className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground sm:text-base">{result.title}</h3>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {result.start !== null && <span className="mr-2 font-mono font-semibold text-primary">{formatTranscriptTimestamp(result.start)}</span>}
                          {formatDate(result.recordingCreatedAt)}
                        </span>
                      </div>
                      <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{result.text}</p>
                    </Link>
                  </li>
                ))}
              </ol>
            )
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyResults({ query, smartAvailable, onSmart }: { query: string; smartAvailable: boolean; onSmart: () => void }) {
  return (
    <div className="py-16 text-center text-muted-foreground">
      <FileText className="mx-auto mb-4 h-12 w-12 opacity-30" aria-hidden="true" />
      <p className="text-base font-medium">No results found for "{query}"</p>
      <p className="mt-1 text-sm">Try different keywords or check your spelling.</p>
      {smartAvailable && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onSmart}>
          Try smart search
        </Button>
      )}
    </div>
  );
}
