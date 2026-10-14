import { cn } from "@/lib/utils";
import { formatDate, formatNumber, t, useI18n } from "@/i18n";

type Usage = {
  enforced: boolean;
  minutesUsed: number;
  minutesLimit: number;
  generationsUsed: number;
  generationsLimit: number;
  resetsOn: string;
};

function Meter({ id, label, used, limit, unit }: { id: string; label: string; used: number; limit: number; unit: "usage.minutes" | "usage.used" }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  const full = used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span id={id} className="font-medium">{label}</span>
        <span className={cn("tabular-nums", full ? "font-medium text-destructive" : "text-muted-foreground")}>
          {t(unit, { used: formatNumber(used), limit: formatNumber(limit) })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={t(unit, { used: formatNumber(used), limit: formatNumber(limit) })}
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/** Allowances reset on the 1st of each UTC month (server/usageRules.ts); worded here in the interface language. */
function nextResetDate(now = new Date()) {
  return formatDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1), { month: "long", day: "numeric", timeZone: "UTC" });
}

/** This month's transcription minutes and AI generations against the plan's allowance. */
export function UsageMeters({ usage, isAdmin = false }: { usage: Usage; isAdmin?: boolean }) {
  useI18n();
  return (
    <div className="space-y-5">
      <Meter id="meter-transcription" label={t("usage.transcription")} used={usage.minutesUsed} limit={usage.minutesLimit} unit="usage.minutes" />
      <Meter id="meter-generations" label={t("usage.generations")} used={usage.generationsUsed} limit={usage.generationsLimit} unit="usage.used" />
      <p className="text-xs text-muted-foreground">
        {t("usage.resets", { date: nextResetDate() })}{" "}
        {usage.enforced ? t("usage.enforced") : isAdmin ? t("usage.admin") : t("usage.off")}
      </p>
    </div>
  );
}
