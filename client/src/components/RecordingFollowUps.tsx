import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { localIsoDate } from "@shared/actionItems";
import { FOLLOW_UP_KIND_LABELS, describeFollowUpDay } from "@shared/followUps";

/**
 * Follow-up suggestions (C7): a short plan for the days after a recording,
 * spaced like review should be. Generated on request and stored; ticking one
 * off keeps it when the plan is made again. Practice steps lead to this
 * recording's flashcards.
 */
export function RecordingFollowUps({
  recordingId,
  transcriptReady,
  audience,
  flashcardCount,
  onOpenFlashcards,
}: {
  recordingId: number;
  transcriptReady: boolean;
  audience: string | null;
  flashcardCount: number;
  onOpenFlashcards: () => void;
}) {
  const utils = trpc.useUtils();
  const today = localIsoDate(new Date());
  const { data, isLoading } = trpc.followUps.list.useQuery({ recordingId }, { enabled: recordingId > 0 });
  const refresh = () => utils.followUps.list.invalidate({ recordingId });

  const generate = trpc.followUps.generate.useMutation({
    onSuccess: () => void refresh(),
    onError: error => toast.error(error.message || "Could not plan follow-ups"),
  });
  const update = trpc.followUps.update.useMutation({ onSuccess: () => void refresh(), onError: error => toast.error(error.message || "Could not update it") });
  const remove = trpc.followUps.remove.useMutation({ onSuccess: () => void refresh(), onError: error => toast.error(error.message || "Could not remove it") });

  const items = data?.items ?? [];
  const open = items.filter(item => !item.done).length;
  const meeting = audience === "professional";

  return (
    <section aria-labelledby="follow-ups-heading" className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="follow-ups-heading" className="font-semibold">Follow-ups</h3>
        {items.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{open} to do</span>}
      </div>

      {isLoading ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : data && !data.available ? (
        <p className="mt-2 text-sm text-muted-foreground">Follow-ups are not available on this server yet.</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {transcriptReady
                ? meeting
                  ? "A few next steps over the coming days, so nothing from this meeting slips."
                  : "A short plan for the next few days, spaced out so this lecture sticks."
                : "Available once the transcript is ready."}
            </p>
          ) : (
            <ol className="mt-1 divide-y divide-border">
              {items.map(item => {
                const checkboxId = `follow-up-${item.id}`;
                const done = update.isPending && update.variables?.id === item.id ? !!update.variables.done : item.done;
                const due = !done && item.dueDate <= today;
                return (
                  <li key={item.id} className="flex items-start gap-3 py-2.5">
                    <Checkbox
                      id={checkboxId}
                      checked={done}
                      onCheckedChange={checked => update.mutate({ id: item.id, done: checked === true })}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={checkboxId} className={cn("block cursor-pointer text-sm font-medium leading-snug", done && "font-normal text-muted-foreground line-through decoration-muted-foreground/60")}>
                        {item.title}
                      </label>
                      {item.detail && !done && <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{item.detail}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                        <span className={cn(due && "font-medium text-primary")}>{describeFollowUpDay(item.dueDate, today)}</span>
                        <span>{FOLLOW_UP_KIND_LABELS[item.kind]}</span>
                        {item.kind === "practice" && !done && flashcardCount > 0 && (
                          <button
                            type="button"
                            onClick={onOpenFlashcards}
                            className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Review flashcards
                          </button>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: item.id })}
                      aria-label={`Remove “${item.title}”`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}

          {transcriptReady && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={items.length ? "ghost" : "outline"}
                className="gap-1.5"
                disabled={generate.isPending}
                onClick={() => generate.mutate({ recordingId, today })}
              >
                {generate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {generate.isPending ? "Planning" : items.length ? "Plan again" : "Plan follow-ups"}
              </Button>
            </div>
          )}
          {items.length > 0 && data?.reminders && (
            <p className="mt-2 text-xs text-muted-foreground">You get a reminder in Notifications on the day, and on this device too if notifications are on.</p>
          )}
        </>
      )}
    </section>
  );
}
