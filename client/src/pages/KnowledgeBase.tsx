import { useState, useCallback } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Clock, ArrowLeft, FileText, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
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
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function KnowledgeBase() {
  const [inputValue, setInputValue] = useState("");
  const debouncedQuery = useDebounce(inputValue, 400);

  const { data: results, isLoading, isFetching } = trpc.knowledgeBase.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2 }
  );

  const handleClear = useCallback(() => setInputValue(""), []);

  const hasQuery = debouncedQuery.trim().length >= 2;
  const showLoading = isLoading || isFetching;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-foreground">Knowledge Base</h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero search */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">Search Your Transcripts</h2>
          <p className="text-muted-foreground text-sm">
            Search across all your recordings and transcripts in one place.
          </p>
        </div>

        {/* Search bar */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search recordings, topics, keywords…"
            className="pl-12 pr-12 h-12 text-base rounded-xl border-2 focus-visible:border-blue-500 shadow-sm"
            autoFocus
          />
          {inputValue && (
            <button
              onClick={handleClear}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Results */}
        {!hasQuery && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium">Type at least 2 characters to search</p>
            <p className="text-sm mt-1">Your recordings and transcripts will appear here</p>
          </div>
        )}

        {hasQuery && showLoading && (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Searching…</span>
          </div>
        )}

        {hasQuery && !showLoading && results && results.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium">No results found for "{debouncedQuery}"</p>
            <p className="text-sm mt-1">Try different keywords or check your spelling</p>
          </div>
        )}

        {hasQuery && !showLoading && results && results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-4">
              {results.length} result{results.length !== 1 ? "s" : ""} for{" "}
              <span className="font-medium text-foreground">"{debouncedQuery}"</span>
            </p>
            {results.map((result) => (
              <Link key={result.recordingId} href={`/recording/${result.recordingId}`}>
                <Card className="hover:shadow-md transition-all duration-150 hover:border-blue-300 cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                          <h3 className="font-semibold text-foreground group-hover:text-blue-600 transition-colors truncate">
                            {result.recordingTitle}
                          </h3>
                        </div>
                        {result.snippet && (
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                            {highlightMatch(result.snippet, debouncedQuery)}
                          </p>
                        )}
                        {!result.snippet && (
                          <p className="text-sm text-muted-foreground italic">
                            Title match — open to view transcript
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge
                          variant={result.transcriptStatus === "completed" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {result.transcriptStatus ?? "pending"}
                        </Badge>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDuration(result.recordingDuration)}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(result.recordingCreatedAt)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
