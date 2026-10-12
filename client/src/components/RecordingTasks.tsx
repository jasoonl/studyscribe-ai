import { useState } from "react";
import { Link } from "wouter";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskItem } from "@/components/TaskItem";
import { trpc } from "@/lib/trpc";
import { localIsoDate } from "@shared/actionItems";

/**
 * Tasks, assignments and deadlines from one recording (C3), shown beside it.
 * "Find tasks" reads the transcript; items can also be added by hand.
 */
export function RecordingTasks({
  recordingId,
  transcriptReady,
  audience,
  onSeek,
}: {
  recordingId: number;
  transcriptReady: boolean;
  audience: string | null;
  onSeek?: (seconds: number) => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const today = localIsoDate(new Date());
  const { data, isLoading } = trpc.actionItems.list.useQuery({ recordingId }, { enabled: recordingId > 0 });
  const refresh = () => Promise.all([utils.actionItems.list.invalidate({ recordingId }), utils.actionItems.listAll.invalidate()]);

  const extract = trpc.actionItems.extract.useMutation({
    onSuccess: result => {
      void refresh();
      if (result.found === 0) toast.message("No tasks or deadlines were mentioned in this recording.");
      else toast.success(result.added === 1 ? "Found 1 task" : `Found ${result.added} tasks`);
    },
    onError: error => toast.error(error.message || "Could not look for tasks"),
  });
  const add = trpc.actionItems.add.useMutation({
    onSuccess: () => {
      setDraft("");
      void refresh();
    },
    onError: error => toast.error(error.message || "Could not add the task"),
  });

  // Open before done, then in the order they were said; hand-added ones (no moment) last.
  const items = [...(data?.items ?? [])].sort(
    (a, b) => Number(a.done) - Number(b.done) || (a.atSeconds ?? Infinity) - (b.atSeconds ?? Infinity) || a.id - b.id,
  );
  const open = items.filter(item => !item.done).length;
  const meeting = audience === "professional";

  return (
    <section aria-labelledby="recording-tasks-heading" className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="recording-tasks-heading" className="font-semibold">
          {meeting ? "Action items" : "Tasks and deadlines"}
        </h3>
        {items.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{open} open</span>}
      </div>

      {isLoading ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : data && !data.available ? (
        <p className="mt-2 text-sm text-muted-foreground">Tasks are not available on this server yet.</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {transcriptReady
                ? meeting
                  ? "Pull out who agreed to do what, and by when."
                  : "Pull out homework, readings and exam dates the lecturer mentioned."
                : "Available once the transcript is ready."}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {items.map(item => (
                <TaskItem key={item.id} item={item} today={today} onChanged={() => void refresh()} onSeek={onSeek} />
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {transcriptReady && (
              <Button type="button" size="sm" variant={items.length ? "ghost" : "outline"} className="gap-1.5" disabled={extract.isPending} onClick={() => extract.mutate({ recordingId })}>
                {extract.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {extract.isPending ? "Reading the transcript" : items.length ? "Look again" : "Find tasks"}
              </Button>
            )}
            {!adding && (
              <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            )}
            <Link href="/tasks" className="ml-auto text-xs font-medium text-primary underline-offset-4 hover:underline">
              All tasks
            </Link>
          </div>

          {adding && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={event => {
                event.preventDefault();
                if (draft.trim()) add.mutate({ recordingId, text: draft.trim() });
              }}
            >
              <Input
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { setAdding(false); setDraft(""); } }}
                placeholder="Something to do"
                aria-label="New task"
                maxLength={500}
                autoFocus
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" disabled={!draft.trim() || add.isPending}>Add</Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
