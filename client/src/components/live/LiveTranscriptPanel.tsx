import { useEffect, useMemo, useRef, useState } from "react";
import { Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupParagraphs, splitLiveText, type LiveTurn } from "@/lib/liveTurns";
import { formatClockTime } from "@/lib/recordingClock";
import { cn } from "@/lib/utils";
import { LiveStatusLabel } from "./LiveStatusLabel";
import type { LiveStatus } from "@/lib/liveTranscription";

const FOLLOW_PAUSE_MS = 5000;

/**
 * The live transcript on the record pages: finished turns in paragraphs with
 * the turn still being spoken in a lighter tone. Follows the newest words
 * unless the reader has scrolled up in the last few seconds.
 */
export function LiveTranscriptPanel({
  turns,
  status,
  message,
  onOpenCaptions,
  footnote,
  className,
}: {
  turns: LiveTurn[];
  status: LiveStatus | "unsupported" | null;
  message: string | null;
  onOpenCaptions?: (opener: HTMLElement) => void;
  footnote?: string;
  className?: string;
}) {
  const { finals, partial } = useMemo(() => splitLiveText(turns), [turns]);
  const paragraphs = useMemo(() => groupParagraphs(finals), [finals]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);
  const programmatic = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || Date.now() - userScrolledAt.current < FOLLOW_PAUSE_MS) return;
    programmatic.current = true;
    element.scrollTop = element.scrollHeight;
    requestAnimationFrame(() => {
      programmatic.current = false;
    });
  }, [turns]);

  // Resume following once the pause has passed, even if no new words arrive.
  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), FOLLOW_PAUSE_MS);
    return () => clearInterval(timer);
  }, []);

  const empty = paragraphs.length === 0 && !partial;

  return (
    <section aria-labelledby="live-transcript-heading" className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm", className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id="live-transcript-heading" className="text-base font-semibold">Live transcript</h2>
          {status && <LiveStatusLabel status={status} />}
        </div>
        {onOpenCaptions && (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={event => onOpenCaptions(event.currentTarget)}>
            <Captions className="h-4 w-4" aria-hidden="true" />
            Captions
          </Button>
        )}
      </header>

      {message && <p className="border-b border-border bg-muted/50 px-5 py-2 text-sm text-muted-foreground">{message}</p>}

      <div
        ref={scrollRef}
        onScroll={() => {
          if (!programmatic.current) userScrolledAt.current = Date.now();
        }}
        tabIndex={0}
        aria-label="Live transcript text"
        className="max-h-[26rem] min-h-40 flex-1 overflow-y-auto px-4 py-4 sm:px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {empty ? (
          <p className="text-base text-muted-foreground">
            {status === "live" ? "Listening. Words appear here as they're spoken." : status === "connecting" || status === "reconnecting" ? "Connecting to live transcription." : "No live text yet."}
          </p>
        ) : (
          <div className="space-y-4 text-base leading-relaxed sm:text-lg">
            <div role="log" aria-live="polite" aria-relevant="additions" className="space-y-4">
              {paragraphs.map(paragraph => (
                <p key={paragraph.key} className="grid grid-cols-[2.75rem_1fr] gap-2 sm:grid-cols-[3.25rem_1fr] sm:gap-3">
                  <span className="pt-1.5 font-mono text-xs tabular-nums text-muted-foreground">{formatClockTime(Math.floor(paragraph.startAt))}</span>
                  <span>{paragraph.turns.map(turn => turn.text).join(" ")}</span>
                </p>
              ))}
            </div>
            {partial && (
              <p className="grid grid-cols-[2.75rem_1fr] gap-2 sm:grid-cols-[3.25rem_1fr] sm:gap-3" aria-hidden="true">
                <span />
                <span className="text-muted-foreground">{partial.text}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {footnote && <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">{footnote}</p>}
    </section>
  );
}
