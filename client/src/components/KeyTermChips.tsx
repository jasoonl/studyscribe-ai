import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Key terms for a recording (B6). Each chip searches the transcript for that
 * term; choosing the active chip again clears the search.
 */
export function KeyTermChips({ recordingId, query, onPick }: { recordingId: number; query: string; onPick: (term: string) => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.insights.get.useQuery({ recordingId }, { enabled: recordingId > 0 });
  const generate = trpc.insights.generateKeyTerms.useMutation({
    onSuccess: () => utils.insights.get.invalidate({ recordingId }),
    onError: error => toast.error(error.message || "Could not find key terms"),
  });

  if (isLoading) return null;
  const terms = data?.keyTerms?.terms ?? [];
  const active = query.trim().toLowerCase();

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 text-muted-foreground">Key terms</span>
      {terms.length === 0 ? (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={generate.isPending} onClick={() => generate.mutate({ recordingId })}>
          {generate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {generate.isPending ? "Reading the transcript" : "Find key terms"}
        </Button>
      ) : (
        <>
          {terms.map(term => {
            const pressed = active === term.toLowerCase();
            const count = data?.keyTerms?.counts[term] ?? 0;
            return (
              <button
                key={term}
                type="button"
                aria-pressed={pressed}
                onClick={() => onPick(pressed ? "" : term)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pressed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-secondary/60",
                )}
              >
                {term}
                <span className={cn("tabular-nums", pressed ? "text-primary-foreground/80" : "text-muted-foreground")}>{count}</span>
              </button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            disabled={generate.isPending}
            onClick={() => generate.mutate({ recordingId })}
            aria-label="Find key terms again"
            title="Find key terms again"
          >
            {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          </Button>
        </>
      )}
    </div>
  );
}
