import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Download, Pencil, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { downloadTranscriptExport, type TranscriptExportFormat } from "@/lib/transcriptExports";
import { formatTranscriptTimestamp, getActiveTranscriptSegmentIndex, type TranscriptSegment } from "@/lib/transcriptSegments";

/** Manual scrolling pauses follow-along for this long, so reading back isn't fought. */
const FOLLOW_PAUSE_MS = 5000;

const EXPORTS: Array<{ format: TranscriptExportFormat; label: string; hint: string }> = [
  { format: "txt", label: "Text", hint: ".txt with timestamps and speakers" },
  { format: "srt", label: "Subtitles", hint: ".srt for video editors and players" },
  { format: "vtt", label: "Web subtitles", hint: ".vtt for HTML5 video" },
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function SpeakerRename({ recordingId, speaker, speakers, children }: { recordingId: number; speaker: string; speakers: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(speaker);
  const utils = trpc.useUtils();
  const rename = trpc.transcription.renameSpeaker.useMutation({
    onSuccess: async () => {
      await utils.transcription.get.invalidate({ recordingId });
      setOpen(false);
      toast.success("Speaker renamed");
    },
    onError: error => toast.error(error.message || "Could not rename the speaker"),
  });
  const trimmed = name.trim();
  const mergesInto = trimmed !== speaker && speakers.includes(trimmed);

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setName(speaker); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72" align="start" onClick={event => event.stopPropagation()}>
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            if (!trimmed || trimmed === speaker) return setOpen(false);
            rename.mutate({ recordingId, from: speaker, to: trimmed });
          }}
        >
          <label className="block text-sm font-medium" htmlFor={`speaker-${speaker}`}>Rename “{speaker}”</label>
          <Input id={`speaker-${speaker}`} value={name} onChange={event => setName(event.target.value)} maxLength={60} autoFocus />
          <p className="text-xs text-muted-foreground">
            {mergesInto ? `Both speakers will become “${trimmed}”.` : "Applies to every line by this speaker. Use another speaker's name to merge them."}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!trimmed || rename.isPending}>{mergesInto ? "Merge" : "Save"}</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function TranscriptView({
  recordingId,
  title,
  segments,
  fullText,
  hasAudio,
  playbackTime,
  onSeek,
}: {
  recordingId: number;
  title: string;
  segments: TranscriptSegment[];
  fullText: string;
  hasAudio: boolean;
  playbackTime: number;
  onSeek: (seconds: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastManualScroll = useRef(0);
  const programmaticScroll = useRef(false);

  const speakers = useMemo(() => Array.from(new Set(segments.map(segment => segment.speaker).filter((speaker): speaker is string => !!speaker))), [segments]);
  const activeIndex = playbackTime > 0 ? getActiveTranscriptSegmentIndex(segments, playbackTime) : -1;

  const trimmedQuery = query.trim();
  const matcher = useMemo(() => (trimmedQuery ? new RegExp(`(${escapeRegExp(trimmedQuery)})`, "gi") : null), [trimmedQuery]);
  const matchRows = useMemo(
    () => (matcher ? segments.flatMap((segment, index) => (segment.text.match(matcher) ? [index] : [])) : []),
    [segments, matcher],
  );
  const currentMatchRow = matchRows.length ? matchRows[Math.min(matchCursor, matchRows.length - 1)] : -1;

  const scrollRowIntoView = (index: number) => {
    const row = rowRefs.current[index];
    const list = listRef.current;
    if (!row || !list) return;
    programmaticScroll.current = true;
    list.scrollTo({ top: row.offsetTop - list.clientHeight / 3, behavior: "smooth" });
    window.setTimeout(() => { programmaticScroll.current = false; }, 600);
  };

  useEffect(() => setMatchCursor(0), [trimmedQuery]);
  useEffect(() => {
    if (currentMatchRow >= 0) scrollRowIntoView(currentMatchRow);
  }, [currentMatchRow]);

  // Follow the audio, unless the user is searching or just scrolled to read.
  useEffect(() => {
    if (activeIndex < 0 || trimmedQuery || Date.now() - lastManualScroll.current < FOLLOW_PAUSE_MS) return;
    scrollRowIntoView(activeIndex);
  }, [activeIndex, trimmedQuery]);

  const step = (delta: number) => {
    if (!matchRows.length) return;
    setMatchCursor(cursor => (cursor + delta + matchRows.length) % matchRows.length);
  };

  const highlight = (text: string, rowIsCurrentMatch: boolean) => {
    if (!matcher) return text;
    return text.split(matcher).map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className={`rounded-sm px-0.5 text-foreground ${rowIsCurrentMatch ? "bg-amber-300" : "bg-amber-100 dark:bg-amber-200/70"}`}>{part}</mark>
      ) : (
        part
      ),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Search this transcript"
            aria-label="Search this transcript"
            className="pl-9 pr-28"
          />
          {trimmedQuery && (
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <span className="px-1.5 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {matchRows.length ? `${Math.min(matchCursor, matchRows.length - 1) + 1} of ${matchRows.length}` : "No matches"}
              </span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => step(-1)} disabled={!matchRows.length} aria-label="Previous match"><ChevronUp className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => step(1)} disabled={!matchRows.length} aria-label="Next match"><ChevronDown className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto">
              <Download className="h-4 w-4" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {EXPORTS.map(item => (
              <DropdownMenuItem key={item.format} onSelect={() => downloadTranscriptExport({ segments, fullText, title }, item.format)} className="flex flex-col items-start gap-0.5">
                <span className="font-medium">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {speakers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Speakers</span>
          {speakers.map(speaker => (
            <SpeakerRename key={speaker} recordingId={recordingId} speaker={speaker} speakers={speakers}>
              <button type="button" className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-primary hover:border-primary/40">
                {speaker}
                <Pencil className="h-3 w-3 opacity-50 group-hover:opacity-100" />
              </button>
            </SpeakerRename>
          ))}
        </div>
      )}

      <div
        ref={listRef}
        onScroll={() => { if (!programmaticScroll.current) lastManualScroll.current = Date.now(); }}
        className="relative max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2"
      >
        {segments.map((segment, index) => {
          const isActive = index === activeIndex;
          const isCurrentMatch = index === currentMatchRow;
          const showSpeaker = !!segment.speaker && segment.speaker !== segments[index - 1]?.speaker;
          return (
            <div
              key={`${segment.id}-${index}`}
              ref={element => { rowRefs.current[index] = element; }}
              onClick={() => hasAudio && onSeek(segment.start)}
              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${hasAudio ? "cursor-pointer" : ""} ${
                isActive ? "bg-primary text-primary-foreground shadow-sm" : isCurrentMatch ? "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-500/10" : "hover:bg-background"
              }`}
            >
              <button
                type="button"
                disabled={!hasAudio}
                onClick={event => { event.stopPropagation(); onSeek(segment.start); }}
                aria-label={`Play from ${formatTranscriptTimestamp(segment.start)}`}
                className={`shrink-0 rounded py-0.5 font-mono text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${isActive ? "text-primary-foreground" : "text-primary"}`}
              >
                {formatTranscriptTimestamp(segment.start)}
              </button>
              <span className="min-w-0 text-sm leading-relaxed">
                {showSpeaker && (
                  <SpeakerRename recordingId={recordingId} speaker={segment.speaker!} speakers={speakers}>
                    <button
                      type="button"
                      onClick={event => event.stopPropagation()}
                      title="Rename speaker"
                      className={`mr-2 rounded text-xs font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isActive ? "text-primary-foreground" : "text-primary"}`}
                    >
                      {segment.speaker}
                    </button>
                  </SpeakerRename>
                )}
                {highlight(segment.text, isCurrentMatch)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
