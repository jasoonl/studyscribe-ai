import { useState, type ReactNode } from "react";
import { CalendarDays, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@shared/timestamp";
import { ACTION_ITEM_KIND_LABELS, daysBetween, describeDueDate, isIsoDate, type ActionItemKind } from "@shared/actionItems";

export type TaskItemData = {
  id: number;
  text: string;
  kind: ActionItemKind;
  owner: string | null;
  dueDate: string | null;
  dueText: string | null;
  atSeconds: number | null;
  done: boolean;
};

function DueDateEditor({ item, today, onSaved, children }: { item: TaskItemData; today: string; onSaved: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(item.dueDate ?? "");
  const update = trpc.actionItems.update.useMutation({
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
    onError: error => toast.error(error.message || "Could not change the date"),
  });

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setValue(item.dueDate ?? today); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            if (!isIsoDate(value)) return;
            update.mutate({ id: item.id, dueDate: value });
          }}
        >
          <label htmlFor={`due-${item.id}`} className="block text-sm font-medium">Due date</label>
          <Input id={`due-${item.id}`} type="date" value={value} onChange={event => setValue(event.target.value)} />
          {item.dueText && <p className="text-xs text-muted-foreground">Said in the recording as “{item.dueText}”.</p>}
          <div className="flex justify-between gap-2">
            {item.dueDate ? (
              <Button type="button" variant="ghost" size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, dueDate: null })}>
                Clear
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={!isIsoDate(value) || update.isPending}>Save</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One task row: tick it off, set or change its due date, jump to where it was
 * said, remove it. `context` is shown in the meta line (the recording it came
 * from, on the combined list).
 */
export function TaskItem({
  item,
  today,
  onChanged,
  onSeek,
  context,
}: {
  item: TaskItemData;
  today: string;
  onChanged: () => void;
  onSeek?: (seconds: number) => void;
  context?: ReactNode;
}) {
  const toggle = trpc.actionItems.update.useMutation({ onSuccess: onChanged, onError: error => toast.error(error.message || "Could not update the task") });
  const remove = trpc.actionItems.remove.useMutation({ onSuccess: onChanged, onError: error => toast.error(error.message || "Could not remove the task") });
  const checkboxId = `task-${item.id}`;
  const overdue = !item.done && !!item.dueDate && daysBetween(today, item.dueDate) < 0;
  const done = toggle.isPending ? !!toggle.variables?.done : item.done;

  return (
    <li className="group flex items-start gap-3 py-2.5">
      <Checkbox
        id={checkboxId}
        checked={done}
        onCheckedChange={checked => toggle.mutate({ id: item.id, done: checked === true })}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={checkboxId} className={cn("block cursor-pointer text-sm leading-snug", done && "text-muted-foreground line-through decoration-muted-foreground/60")}>
          {item.text}
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          {item.kind !== "task" && <span>{ACTION_ITEM_KIND_LABELS[item.kind]}</span>}
          {item.owner && <span>{item.owner}</span>}
          <DueDateEditor item={item} today={today} onSaved={onChanged}>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                overdue && "font-medium text-destructive",
              )}
              aria-label={item.dueDate ? `Due ${describeDueDate(item.dueDate, today)}. Change the date` : "Add a due date"}
            >
              <CalendarDays className="h-3 w-3" />
              {item.dueDate ? describeDueDate(item.dueDate, today) : "Add date"}
            </button>
          </DueDateEditor>
          {item.atSeconds !== null && onSeek && (
            <button
              type="button"
              onClick={() => onSeek(item.atSeconds!)}
              className="font-mono tabular-nums text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Play from where this was said`}
            >
              {formatTimestamp(item.atSeconds)}
            </button>
          )}
          {context}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ id: item.id })}
        aria-label={`Remove “${item.text}”`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
