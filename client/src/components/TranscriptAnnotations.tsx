import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Highlighter, Loader2, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MentionText, MentionTextarea, useMentionCandidates, type MentionPerson } from "@/components/MentionTextarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatTranscriptTimestamp, type TranscriptSegment } from "@/lib/transcriptSegments";

/**
 * Transcript comments and highlights (B7): the data hook, the toolbar that
 * appears over a text selection, and the list of threads under the transcript.
 */

export type AnnotationThread = {
  id: number;
  authorId: number;
  authorName: string;
  kind: "highlight" | "comment";
  segmentIndex: number;
  segmentId: string | null;
  startOffset: number;
  endOffset: number;
  quote: string;
  body: string | null;
  resolved: boolean;
  createdAt: string | Date;
  replies: Array<{ id: number; authorId: number; authorName: string; body: string | null; createdAt: string | Date }>;
};

export type AnnotationPermissions = {
  canSee: boolean;
  canComment: boolean;
  canModerate: boolean;
  canResolveAny: boolean;
  currentUserId: number;
};

export type PendingSelection = { segmentIndex: number; segmentId?: string; startOffset: number; endOffset: number; quote: string; top: number; left: number };

export function useTranscriptAnnotations(recordingId: number, enabled: boolean) {
  const query = trpc.annotations.list.useQuery({ recordingId }, { enabled: enabled && recordingId > 0, retry: false });
  const threads = (query.data?.threads ?? []) as AnnotationThread[];
  return {
    threads,
    permissions: query.data?.permissions as AnnotationPermissions | undefined,
    available: query.data?.available ?? true,
    isLoading: query.isLoading && enabled,
  };
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** Whether a thread's anchor still points at the same words (a transcript edit can move them). */
export function anchorIsCurrent(thread: Pick<AnnotationThread, "segmentIndex" | "segmentId" | "startOffset" | "endOffset" | "quote">, segments: TranscriptSegment[]) {
  const segment = segments[thread.segmentIndex];
  if (!segment) return false;
  if (thread.segmentId && segment.id && thread.segmentId !== segment.id) return false;
  return squash(segment.text.slice(thread.startOffset, thread.endOffset)) === squash(thread.quote);
}

/**
 * Reads the current selection if it lies inside one segment's text and
 * returns offsets into that text plus where to show the toolbar.
 */
export function readSelection(container: HTMLElement): PendingSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const startEl = (range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest<HTMLElement>("[data-seg-text]");
  const endEl = (range.endContainer.nodeType === Node.ELEMENT_NODE ? (range.endContainer as Element) : range.endContainer.parentElement)?.closest<HTMLElement>("[data-seg-text]");
  if (!startEl || startEl !== endEl || !container.contains(startEl)) return null;
  const before = document.createRange();
  before.selectNodeContents(startEl);
  before.setEnd(range.startContainer, range.startOffset);
  let start = before.toString().length;
  const raw = range.toString();
  let end = start + raw.length;
  const full = startEl.textContent ?? "";
  while (start < end && /\s/.test(full[start])) start++;
  while (end > start && /\s/.test(full[end - 1])) end--;
  if (end - start < 2) return null;
  const rect = range.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  return {
    segmentIndex: Number(startEl.dataset.segIndex),
    segmentId: startEl.dataset.segId || undefined,
    startOffset: start,
    endOffset: end,
    quote: full.slice(start, end).slice(0, 500),
    top: rect.top - box.top + container.scrollTop,
    left: Math.min(Math.max(rect.left - box.left + rect.width / 2, 120), box.width - 120),
  };
}

export function SelectionToolbar({
  recordingId,
  selection,
  onDone,
}: {
  recordingId: number;
  selection: PendingSelection;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const people = useMentionCandidates(recordingId, writing);
  const create = trpc.annotations.create.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.annotations.list.invalidate({ recordingId });
      toast.success(variables.kind === "comment" ? "Comment added" : "Highlighted");
      onDone();
    },
    onError: error => toast.error(error.message || "Could not save that"),
  });

  useEffect(() => {
    if (writing) textareaRef.current?.focus();
  }, [writing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const save = (kind: "highlight" | "comment") =>
    create.mutate({
      recordingId,
      kind,
      body: kind === "comment" ? body.trim() : undefined,
      segmentIndex: selection.segmentIndex,
      segmentId: selection.segmentId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      quote: selection.quote,
    });

  return (
    <div
      role="dialog"
      aria-label="Highlight or comment on the selected words"
      className="absolute z-20 -translate-x-1/2 -translate-y-full"
      style={{ top: selection.top - 8, left: selection.left }}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      {writing ? (
        <form
          className="w-72 space-y-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          onSubmit={event => {
            event.preventDefault();
            if (body.trim()) save("comment");
          }}
        >
          <p className="line-clamp-2 text-xs text-muted-foreground">“{selection.quote}”</p>
          <MentionTextarea
            ref={textareaRef}
            value={body}
            onValueChange={setBody}
            people={people}
            onSubmitShortcut={() => {
              if (body.trim()) save("comment");
            }}
            placeholder="Add a comment, @ to mention"
            aria-label="Comment"
            rows={3}
            maxLength={4000}
            className="resize-none text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!body.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Comment"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" disabled={create.isPending} onClick={() => save("highlight")}>
            <Highlighter className="h-4 w-4" />
            Highlight
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setWriting(true)}>
            <MessageSquare className="h-4 w-4" />
            Comment
          </Button>
        </div>
      )}
    </div>
  );
}

function when(value: string | Date) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function ThreadCard({
  thread,
  recordingId,
  permissions,
  stale,
  active,
  hasAudio,
  start,
  onGoTo,
  registerRef,
  people,
}: {
  people: MentionPerson[];
  thread: AnnotationThread;
  recordingId: number;
  permissions: AnnotationPermissions;
  stale: boolean;
  active: boolean;
  hasAudio: boolean;
  start: number | null;
  onGoTo: () => void;
  registerRef: (element: HTMLLIElement | null) => void;
}) {
  const utils = trpc.useUtils();
  const [reply, setReply] = useState("");
  const refresh = () => utils.annotations.list.invalidate({ recordingId });
  const onError = (error: { message: string }) => toast.error(error.message || "That did not work");
  const sendReply = trpc.annotations.reply.useMutation({ onSuccess: async () => { setReply(""); await refresh(); }, onError });
  const setResolved = trpc.annotations.setResolved.useMutation({ onSuccess: refresh, onError });
  const remove = trpc.annotations.remove.useMutation({ onSuccess: refresh, onError });

  const me = permissions.currentUserId;
  const canResolve = thread.authorId === me || permissions.canResolveAny;
  const canRemove = (authorId: number) => authorId === me || permissions.canModerate;

  return (
    <li
      ref={registerRef}
      className={cn("scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm", active && "ring-2 ring-ring", thread.resolved && "bg-muted/40")}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onGoTo}
          className="min-w-0 rounded text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {start !== null && <span className="mr-1.5 font-mono font-semibold text-primary">{formatTranscriptTimestamp(start)}</span>}
          <span className="line-clamp-2">
            <mark className="rounded-sm bg-annotation px-0.5 text-foreground">{thread.quote}</mark>
          </span>
          {stale && <span className="mt-1 block">The transcript has changed since this was added.</span>}
        </button>
        <div className="flex shrink-0 items-center">
          {thread.kind === "comment" && canResolve && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={setResolved.isPending}
              onClick={() => setResolved.mutate({ id: thread.id, resolved: !thread.resolved })}
              aria-label={thread.resolved ? "Reopen thread" : "Resolve thread"}
              title={thread.resolved ? "Reopen" : "Resolve"}
            >
              {thread.resolved ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            </Button>
          )}
          {canRemove(thread.authorId) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: thread.id })}
              aria-label={thread.kind === "highlight" ? "Remove highlight" : "Delete thread"}
              title={thread.kind === "highlight" ? "Remove highlight" : "Delete"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-3">
        <div>
          <p className="text-sm">
            <span className="font-semibold">{thread.authorId === me ? "You" : thread.authorName}</span>{" "}
            <span className="text-xs text-muted-foreground">
              {thread.kind === "highlight" ? "highlighted this" : ""} {when(thread.createdAt)}
              {thread.resolved && ", resolved"}
            </span>
          </p>
          {thread.body && <MentionText body={thread.body} people={people} className="mt-1 whitespace-pre-wrap text-sm leading-relaxed" />}
        </div>
        {thread.replies.map(item => (
          <div key={item.id} className="flex items-start justify-between gap-2 pl-4">
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-semibold">{item.authorId === me ? "You" : item.authorName}</span> <span className="text-xs text-muted-foreground">{when(item.createdAt)}</span>
              </p>
              <MentionText body={item.body ?? ""} people={people} className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed" />
            </div>
            {canRemove(item.authorId) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove.mutate({ id: item.id })}
                aria-label="Delete reply"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {thread.kind === "comment" && permissions.canComment && (
          <form
            className="flex gap-2 pl-4"
            onSubmit={event => {
              event.preventDefault();
              if (reply.trim()) sendReply.mutate({ parentId: thread.id, body: reply.trim() });
            }}
          >
            <MentionTextarea
              value={reply}
              onValueChange={setReply}
              people={people}
              onSubmitShortcut={() => {
                if (reply.trim()) sendReply.mutate({ parentId: thread.id, body: reply.trim() });
              }}
              placeholder="Reply"
              aria-label={`Reply to ${thread.authorName}`}
              rows={1}
              maxLength={4000}
              className="min-h-9 resize-none text-sm"
            />
            <Button type="submit" size="sm" variant="outline" disabled={!reply.trim() || sendReply.isPending}>
              Reply
            </Button>
          </form>
        )}
      </div>
    </li>
  );
}

export function CommentsPanel({
  recordingId,
  threads,
  permissions,
  segments,
  activeId,
  hasAudio,
  onGoTo,
}: {
  recordingId: number;
  threads: AnnotationThread[];
  permissions: AnnotationPermissions;
  segments: TranscriptSegment[];
  activeId: number | null;
  hasAudio: boolean;
  onGoTo: (thread: AnnotationThread) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const people = useMentionCandidates(recordingId, permissions.canSee && threads.length > 0);
  const refs = useRef(new Map<number, HTMLLIElement>());
  const open = threads.filter(thread => !thread.resolved);
  const resolved = threads.filter(thread => thread.resolved);
  const shown = (showResolved ? resolved : open).slice().sort((a, b) => a.segmentIndex - b.segmentIndex || a.startOffset - b.startOffset);

  useEffect(() => {
    if (activeId === null) return;
    const thread = threads.find(item => item.id === activeId);
    if (thread?.resolved && !showResolved) setShowResolved(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    refs.current.get(activeId)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [activeId, threads, showResolved]);

  return (
    <section aria-labelledby="transcript-comments-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id="transcript-comments-heading" className="font-semibold">
          Comments and highlights
        </h4>
        <div className="flex items-center gap-1 text-sm" role="group" aria-label="Show">
          <Button type="button" size="sm" variant={showResolved ? "ghost" : "secondary"} className="h-7 px-2.5 text-xs" aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>
            Open {open.length}
          </Button>
          <Button type="button" size="sm" variant={showResolved ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" aria-pressed={showResolved} onClick={() => setShowResolved(true)}>
            Resolved {resolved.length}
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {showResolved
            ? "Nothing resolved yet."
            : permissions.canComment
              ? "Select words in the transcript to highlight them or start a comment."
              : "No comments yet."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map(thread => (
            <ThreadCard
              key={thread.id}
              people={people}
              thread={thread}
              recordingId={recordingId}
              permissions={permissions}
              stale={!anchorIsCurrent(thread, segments)}
              active={thread.id === activeId}
              hasAudio={hasAudio}
              start={segments[thread.segmentIndex]?.start ?? null}
              onGoTo={() => onGoTo(thread)}
              registerRef={element => {
                if (element) refs.current.set(thread.id, element);
                else refs.current.delete(thread.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
