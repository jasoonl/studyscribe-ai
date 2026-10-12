import { Bookmark, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";

/**
 * Moments marked while recording, plus a button to mark the current playback
 * position. Shown under the audio player.
 */
export function RecordingBookmarks({ recordingId, playbackTime, onSeek }: { recordingId: number; playbackTime: number; onSeek: (seconds: number) => void }) {
  const utils = trpc.useUtils();
  const { data: bookmarks } = trpc.bookmarks.list.useQuery({ recordingId }, { enabled: recordingId > 0 });
  const refresh = () => utils.bookmarks.list.invalidate({ recordingId });
  const add = trpc.bookmarks.add.useMutation({
    onSuccess: () => { void refresh(); toast.success(`Marked ${formatTranscriptTimestamp(Math.floor(playbackTime))}`); },
    onError: error => toast.error(error.message || "Could not mark this moment"),
  });
  const remove = trpc.bookmarks.remove.useMutation({ onSuccess: () => void refresh() });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Bookmark className="h-4 w-4" /> Marked moments
      </span>
      {bookmarks?.map(mark => (
        <span key={mark.id} className="inline-flex items-center rounded-md border border-border bg-background text-xs">
          <button
            type="button"
            onClick={() => onSeek(mark.atSeconds)}
            className="px-2.5 py-1 font-mono font-semibold tabular-nums text-primary hover:underline"
            aria-label={`Play from ${formatTranscriptTimestamp(mark.atSeconds)}`}
          >
            {formatTranscriptTimestamp(mark.atSeconds)}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate({ id: mark.id })}
            className="border-l border-border px-1.5 py-1 text-muted-foreground hover:text-destructive"
            aria-label={`Remove the mark at ${formatTranscriptTimestamp(mark.atSeconds)}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {bookmarks?.length === 0 && <span className="text-xs text-muted-foreground">None yet.</span>}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={add.isPending}
        onClick={() => add.mutate({ recordingId, atSeconds: Math.floor(playbackTime) })}
      >
        <Plus className="h-3.5 w-3.5" /> Mark {formatTranscriptTimestamp(Math.floor(playbackTime))}
      </Button>
    </div>
  );
}
