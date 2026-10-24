import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** A progress bar with a name; with no known percent it pulses (and holds still under reduced motion). */
export function SourceProgress({ percent, label, valueText, className }: { percent: number | null; label: string; valueText: string; className?: string }) {
  if (percent === null) {
    return (
      <div role="progressbar" aria-label={label} aria-valuetext={valueText} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-primary/20", className)}>
        <div className="h-full w-1/3 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }
  return <Progress className={cn("h-1.5", className)} value={percent} aria-label={label} aria-valuetext={valueText} />;
}
