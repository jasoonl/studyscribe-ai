import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";
import { cn } from "@/lib/utils";
import { slideAt } from "@shared/slides";
export { slidesBeforeSegments } from "@shared/slides";

export type SlideItem = { id: number; atSeconds: number; url: string; width: number; height: number };

/** Slides captured while recording (A6), for any page that shows a recording. */
export function useRecordingSlides(recordingId: number, enabled = true) {
  const { data } = trpc.slides.list.useQuery({ recordingId }, { enabled: enabled && recordingId > 0, retry: false, refetchOnWindowFocus: false });
  return data ?? [];
}

/** Full-size view of one slide, with previous and next (arrow keys too) and "Play from here". */
export function SlideViewer({
  slides,
  index,
  onIndexChange,
  onClose,
  onSeek,
}: {
  slides: SlideItem[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const slide = index !== null ? slides[index] : null;
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && index < slides.length - 1) onIndexChange(index + 1);
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, slides.length, onIndexChange]);

  return (
    <Dialog open={slide !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[min(64rem,calc(100vw-2rem))] gap-4 p-4 sm:p-6">
        {slide && index !== null && (
          <>
            <div>
              <DialogTitle className="text-base">Slide {index + 1} of {slides.length}</DialogTitle>
              <DialogDescription>Captured at {formatTranscriptTimestamp(slide.atSeconds)}</DialogDescription>
            </div>
            <img
              src={slide.url}
              alt={`Slide ${index + 1}, captured at ${formatTranscriptTimestamp(slide.atSeconds)}`}
              width={slide.width}
              height={slide.height}
              className="h-auto max-h-[70vh] w-full rounded-lg border border-border bg-muted object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={index === 0} onClick={() => onIndexChange(index - 1)} aria-label="Previous slide">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={index === slides.length - 1} onClick={() => onIndexChange(index + 1)} aria-label="Next slide">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {onSeek && (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    onSeek(slide.atSeconds);
                    onClose();
                  }}
                >
                  <Play className="h-3.5 w-3.5" />
                  Play from {formatTranscriptTimestamp(slide.atSeconds)}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "Slides" strip under the player: every captured slide in order, the one
 * on screen at the current playback time marked. Hidden when there are none.
 */
export function RecordingSlides({ slides, playbackTime, onSeek }: { slides: SlideItem[]; playbackTime: number; onSeek?: (seconds: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  if (slides.length === 0) return null;
  const current = playbackTime > 0 ? slideAt(slides, playbackTime) : null;

  return (
    <section aria-labelledby="recording-slides" className="mt-5 border-t border-border pt-4">
      <h3 id="recording-slides" className="mb-2 text-sm font-semibold text-muted-foreground">
        Slides<span className="ml-1.5 font-normal tabular-nums">{slides.length}</span>
      </h3>
      <ol className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {slides.map((slide, index) => {
          const isCurrent = current?.id === slide.id;
          return (
            <li key={slide.id} className="w-40 shrink-0 snap-start sm:w-48">
              <button
                type="button"
                onClick={() => setOpen(index)}
                aria-label={`Open slide ${index + 1}, at ${formatTranscriptTimestamp(slide.atSeconds)}`}
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "block w-full overflow-hidden rounded-lg border bg-muted text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isCurrent ? "border-primary" : "border-border hover:border-primary/60",
                )}
              >
                <img src={slide.url} alt="" loading="lazy" width={slide.width} height={slide.height} className="aspect-video h-auto w-full object-cover" />
              </button>
              <p className={cn("mt-1 font-mono text-xs tabular-nums", isCurrent ? "font-semibold text-primary" : "text-muted-foreground")}>
                {formatTranscriptTimestamp(slide.atSeconds)}
              </p>
            </li>
          );
        })}
      </ol>
      <SlideViewer slides={slides} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} onSeek={onSeek} />
    </section>
  );
}
