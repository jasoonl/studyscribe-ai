import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Minus, Plus, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { splitLiveText, type LiveTurn } from "@/lib/liveTurns";
import { getCaptionSize, setCaptionSize } from "@/lib/preferences";
import type { LiveStatus } from "@/lib/liveTranscription";

/** Caption sizes in pixels, chosen to stay readable from across a room. */
export const CAPTION_SIZES = [28, 36, 48, 60, 76] as const;
/** A smaller start on phones, where 48px fits only a few words per line. */
const defaultSize = () => (typeof window !== "undefined" && window.innerWidth < 640 ? 1 : 2);
/** Only the newest turns are drawn; older lines scroll off the top anyway. */
const VISIBLE_TURNS = 14;

const STATUS_WORDS: Partial<Record<LiveStatus | "unsupported", string>> = {
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  paused: "Recording paused",
  error: "Live text stopped",
  unavailable: "Live text unavailable",
  unsupported: "Live text unavailable",
};

/**
 * Live captions (F6): the live transcript in large, high-contrast type for
 * students who are deaf or hard of hearing, or anyone following from a
 * distance. Full screen, white on black in both themes, text size remembered
 * per browser. Esc closes it; + and - change the size.
 */
export function LiveCaptions({
  open,
  onOpenChange,
  turns,
  status,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turns: LiveTurn[];
  status: LiveStatus | "unsupported" | null;
  /** Where keyboard focus goes back to on exit (the button that opened it). */
  returnFocusTo?: () => HTMLElement | null;
}) {
  const [size, setSize] = useState(() => Math.min(getCaptionSize(defaultSize()), CAPTION_SIZES.length - 1));
  const { finals, partial } = useMemo(() => splitLiveText(turns), [turns]);
  const recent = finals.slice(-VISIBLE_TURNS);
  const bottomRef = useRef<HTMLDivElement>(null);

  const changeSize = (delta: number) => {
    setSize(current => {
      const next = Math.max(0, Math.min(CAPTION_SIZES.length - 1, current + delta));
      setCaptionSize(next);
      return next;
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, size, open]);

  const statusWords = status ? STATUS_WORDS[status] : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            const target = returnFocusTo?.();
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onKeyDown={event => {
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              changeSize(1);
            } else if (event.key === "-" || event.key === "_") {
              event.preventDefault();
              changeSize(-1);
            }
          }}
          className="fixed inset-0 z-[60] flex flex-col bg-black text-white focus:outline-none"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/25 px-4 py-3 sm:px-8">
            <div className="flex items-center gap-3">
              <DialogPrimitive.Title className="text-base font-semibold">Live captions</DialogPrimitive.Title>
              {statusWords && <span className="text-sm text-white/80">{statusWords}</span>}
            </div>
            <div className="flex items-center gap-2">
              <div role="group" aria-label="Text size" className="flex items-center rounded-lg border border-white/40">
                <button
                  type="button"
                  onClick={() => changeSize(-1)}
                  disabled={size === 0}
                  aria-label="Smaller text"
                  className="flex h-10 w-11 items-center justify-center rounded-l-lg hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:text-white/40 disabled:hover:bg-transparent"
                >
                  <Minus className="h-5 w-5" aria-hidden="true" />
                </button>
                <span className="w-14 border-x border-white/40 text-center text-sm tabular-nums" aria-live="polite">
                  {CAPTION_SIZES[size]}px
                </span>
                <button
                  type="button"
                  onClick={() => changeSize(1)}
                  disabled={size === CAPTION_SIZES.length - 1}
                  aria-label="Larger text"
                  className="flex h-10 w-11 items-center justify-center rounded-r-lg hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:text-white/40 disabled:hover:bg-transparent"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <DialogPrimitive.Close className="flex h-10 items-center gap-2 rounded-lg border border-white/40 px-3 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <X className="h-5 w-5" aria-hidden="true" />
                Exit
                <Kbd className="hidden border-white/40 bg-transparent text-white sm:inline-flex">Esc</Kbd>
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-4 pb-10 sm:px-12">
            <div
              className="max-w-[60ch] overflow-y-auto font-medium"
              style={{ fontSize: `${CAPTION_SIZES[size]}px`, lineHeight: 1.3 }}
            >
              {recent.length === 0 && !partial ? (
                <p className="text-white/80" style={{ fontSize: "0.6em" }}>
                  {status === "live" || status === "connecting" || status === "reconnecting"
                    ? "Captions appear here as people speak."
                    : "Turn on live text and start recording to see captions."}
                </p>
              ) : (
                <>
                  <div role="log" aria-live="polite" aria-relevant="additions">
                    {recent.map(turn => (
                      <p key={turn.key} className="mb-[0.35em]">{turn.text}</p>
                    ))}
                  </div>
                  {partial && (
                    <p aria-hidden="true" className="mb-[0.35em] text-white/85 underline decoration-white/30 decoration-2 underline-offset-[0.2em]">
                      {partial.text}
                    </p>
                  )}
                </>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          <p className="px-4 pb-3 text-xs text-white/70 sm:px-8">
            Automatic captions can contain mistakes. Press <span className="font-semibold">+</span> or <span className="font-semibold">-</span> to change the size.
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
