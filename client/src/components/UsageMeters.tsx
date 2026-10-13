import { cn } from "@/lib/utils";

type Usage = {
  enforced: boolean;
  minutesUsed: number;
  minutesLimit: number;
  generationsUsed: number;
  generationsLimit: number;
  resetsOn: string;
};

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  const full = used >= limit;
  const id = `meter-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span id={id} className="font-medium">{label}</span>
        <span className={cn("tabular-nums", full ? "font-medium text-destructive" : "text-muted-foreground")}>
          {used.toLocaleString("en-US")} of {limit.toLocaleString("en-US")} {unit}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} ${unit} used`}
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/** This month's transcription minutes and AI generations against the plan's allowance. */
export function UsageMeters({ usage, isAdmin = false }: { usage: Usage; isAdmin?: boolean }) {
  return (
    <div className="space-y-5">
      <Meter label="Transcription" used={usage.minutesUsed} limit={usage.minutesLimit} unit="minutes" />
      <Meter label="AI generations" used={usage.generationsUsed} limit={usage.generationsLimit} unit="used" />
      <p className="text-xs text-muted-foreground">
        Resets on {usage.resetsOn}.{" "}
        {usage.enforced
          ? "A recording that starts within your allowance always finishes."
          : isAdmin
            ? "Admins are not limited."
            : "Limits are not switched on yet, so nothing is blocked."}
      </p>
    </div>
  );
}
