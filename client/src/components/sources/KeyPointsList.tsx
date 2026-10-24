import { useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { filterFlags } from "@/lib/sourceModel";
import { useI18n } from "@/i18n";
import { LocationChip } from "./LocationChip";

import type { SourceFlag } from "@/lib/sourceModel";
export type { SourceFlag };


export function KeyPointsList({ sourceId, flags, initial = "test" }: { sourceId: number; flags: SourceFlag[]; initial?: "all" | "test" }) {
  const { t, tn } = useI18n();
  const [filter, setFilter] = useState<"all" | "test">(initial);
  const shown = useMemo(() => filterFlags(flags, filter), [flags, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={value => value && setFilter(value as "all" | "test")}
          variant="outline"
          aria-label={t("sources.points.filter")}
        >
          <ToggleGroupItem value="test" className="min-h-10 px-4">
            {t("sources.points.likely")}
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="min-h-10 px-4">
            {t("sources.points.all")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {tn("sources.points.count", shown.length)}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
          {flags.length === 0 ? t("sources.points.none") : t("sources.points.noneLikely")}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map(flag => (
            <li key={flag.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{t(`sources.flag.${flag.kind}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`sources.importance.${Math.min(3, Math.max(1, flag.importance)) as 1 | 2 | 3}`)}</span>
              </div>
              <p className="text-base leading-relaxed text-foreground">{flag.text}</p>
              {flag.quote && (
                <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground [overflow-wrap:anywhere]">{flag.quote}</blockquote>
              )}
              <div className="mt-3">
                <LocationChip sourceId={sourceId} unitIndex={flag.unitIndex} label={flag.label} quote={flag.quote} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
