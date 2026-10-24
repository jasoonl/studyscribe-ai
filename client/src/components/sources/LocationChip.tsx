import { Link } from "wouter";
import { formatLocation, sourceHref } from "@/lib/sourceLocation";
import { useI18n } from "@/i18n";

/** A page, slide or section as a link that opens that place in the source. */
export function LocationChip({ sourceId, unitIndex, label, quote }: { sourceId: number; unitIndex: number; label: string; quote?: string | null }) {
  const { t } = useI18n();
  const text = formatLocation(label, t);
  return (
    <Link
      href={sourceHref(sourceId, { unitIndex, quote })}
      aria-label={t("sources.location.open", { place: text })}
      className="inline-flex min-h-8 max-w-full items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground underline-offset-2 hover:border-primary/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{text}</span>
    </Link>
  );
}
