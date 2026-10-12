import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";
import { cn } from "@/lib/utils";

const COLLAPSED_COUNT = 5;

/** Index of the chapter playing at `time`: the last one that has started. */
export function activeChapterIndex(chapters: Array<{ start: number }>, time: number): number {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= time) index = i;
  return index;
}

/**
 * Chapters (B8): the recording's outline with timestamps. Selecting one plays
 * from there; the one playing now is marked.
 */
export function RecordingChapters({
  recordingId,
  transcriptReady,
  hasAudio,
  playbackTime,
  onSeek,
}: {
  recordingId: number;
  transcriptReady: boolean;
  hasAudio: boolean;
  playbackTime: number;
  onSeek: (seconds: number) => void;
}) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = trpc.insights.get.useQuery({ recordingId }, { enabled: recordingId > 0 && transcriptReady });
  const generate = trpc.insights.generateChapters.useMutation({
    onSuccess: () => utils.insights.get.invalidate({ recordingId }),
    onError: error => toast.error(error.message || "Could not make chapters"),
  });

  if (!transcriptReady || isLoading) return null;
  const chapters = data?.chapters ?? [];
  const current = playbackTime > 0 ? activeChapterIndex(chapters, playbackTime) : -1;
  const visible = expanded || chapters.length <= COLLAPSED_COUNT + 1 ? chapters : chapters.slice(0, COLLAPSED_COUNT);

  return (
    <section aria-labelledby={`chapters-${recordingId}`} className="mt-5 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 id={`chapters-${recordingId}`} className="text-sm font-semibold text-muted-foreground">
          Chapters{chapters.length > 0 && <span className="ml-1.5 font-normal tabular-nums">{chapters.length}</span>}
        </h3>
        {chapters.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            disabled={generate.isPending}
            onClick={() => generate.mutate({ recordingId })}
          >
            {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Redo
          </Button>
        )}
      </div>

      {chapters.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-muted/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Split the recording into sections by topic, each one a place to jump to.</p>
          <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1.5" disabled={generate.isPending} onClick={() => generate.mutate({ recordingId })}>
            {generate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {generate.isPending ? "Making chapters" : "Make chapters"}
          </Button>
        </div>
      ) : (
        <>
          <ol className="-mx-2">
            {visible.map((chapter, index) => {
              const isCurrent = index === current;
              return (
                <li key={`${chapter.start}-${index}`}>
                  <button
                    type="button"
                    disabled={!hasAudio}
                    onClick={() => onSeek(chapter.start)}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "grid w-full grid-cols-[4.25rem_1fr] items-baseline gap-x-3 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                      isCurrent ? "bg-secondary" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="font-mono text-xs font-semibold tabular-nums text-primary">{formatTranscriptTimestamp(chapter.start)}</span>
                    <span className="min-w-0">
                      <span className={cn("block text-sm leading-snug", isCurrent ? "font-semibold" : "font-medium")}>{chapter.title}</span>
                      {chapter.summary && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{chapter.summary}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {chapters.length > COLLAPSED_COUNT + 1 && (
            <button
              type="button"
              onClick={() => setExpanded(value => !value)}
              aria-expanded={expanded}
              className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Show fewer" : `Show all ${chapters.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
