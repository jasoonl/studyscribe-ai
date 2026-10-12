import { useEffect } from "react";
import { Bookmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useRecorder } from "@/contexts/RecorderContext";
import { formatClockTime } from "@/lib/recordingClock";

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName));
}

/** "Mark moment" during a recording, with the B key as a shortcut. */
export function MarkMoment() {
  const { status, bookmarks, addBookmark } = useRecorder();
  const live = status === "recording" || status === "paused";

  const mark = () => {
    const at = addBookmark();
    if (at !== null) toast.success(`Marked ${formatClockTime(at)}`, { duration: 1500 });
  };

  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      mark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!live && bookmarks.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      {live && (
        <Button type="button" variant="outline" size="lg" onClick={mark} className="gap-2">
          <Bookmark className="h-5 w-5" />
          Mark moment
          <Kbd className="ml-1 hidden sm:inline-flex">B</Kbd>
        </Button>
      )}
      {bookmarks.length > 0 && (
        <p className="text-center text-sm text-muted-foreground">
          {bookmarks.length === 1 ? "1 moment marked" : `${bookmarks.length} moments marked`}:{" "}
          <span className="font-mono tabular-nums text-foreground">{bookmarks.map(formatClockTime).join(", ")}</span>
        </p>
      )}
    </div>
  );
}
