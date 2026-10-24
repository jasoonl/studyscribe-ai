import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLocation, findQuote } from "@/lib/sourceLocation";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type Props = {
  sourceId: number;
  units: { unitIndex: number; label: string }[];
  /** 0-based index of the unit shown. */
  current: number;
  quote: string | null;
  onSelect: (unitIndex: number) => void;
  /** Move keyboard focus to the heading when the page changes because of a link. */
  focusHeading: boolean;
};

/** Extracted text of one page, slide or section, with the cited quote highlighted. */
export function PassageViewer({ sourceId, units, current, quote, onSelect, focusHeading }: Props) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const mark = useRef<HTMLElement>(null);
  const unit = trpc.sources.getUnit.useQuery({ id: sourceId, unitIndex: current }, { retry: false, placeholderData: previous => previous });
  const position = units.findIndex(item => item.unitIndex === current);
  const previous = position > 0 ? units[position - 1] : null;
  const next = position >= 0 && position < units.length - 1 ? units[position + 1] : null;
  const label = (value: string) => formatLocation(value, t);
  const text = unit.data && unit.data.unitIndex === current ? unit.data.text : null;
  const range = text ? findQuote(text, quote) : null;

  // Focus and scroll once per page and quote, not on every render: the page re-renders on a timer,
  // and an effect that re-ran would pull focus back to the heading each time.
  const applied = useRef<string | null>(null);
  const key = `${sourceId}:${current}:${quote ?? ""}`;
  useEffect(() => {
    if (!text || applied.current === key) return;
    applied.current = key;
    if (focusHeading) heading.current?.focus({ preventScroll: true });
    (mark.current ?? heading.current)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [text, key, focusHeading]);

  return (
    <div className="grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label={t("sources.pages.list")} className="hidden md:block">
        <ul className="max-h-[32rem] space-y-0.5 overflow-y-auto pr-1">
          {units.map(item => (
            <li key={item.unitIndex}>
              <button
                type="button"
                aria-current={item.unitIndex === current ? "page" : undefined}
                onClick={() => onSelect(item.unitIndex)}
                className={cn(
                  "block min-h-9 w-full truncate rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  item.unitIndex === current ? "bg-brand-mist font-medium text-primary" : "text-foreground hover:bg-secondary",
                )}
              >
                {label(item.label)}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="md:hidden">
          <Select value={String(current)} onValueChange={value => onSelect(Number.parseInt(value, 10))}>
            <SelectTrigger className="w-full" aria-label={t("sources.pages.choose")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map(item => (
                <SelectItem key={item.unitIndex} value={String(item.unitIndex)}>
                  {label(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <article className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          <h3 ref={heading} tabIndex={-1} className="mb-3 text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {label(units[position]?.label ?? "")}
          </h3>
          {unit.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("sources.pages.error")}
              <Button variant="link" className="px-1" onClick={() => void unit.refetch()}>
                {t("sources.retry")}
              </Button>
            </p>
          ) : text === null ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {range ? (
                <>
                  {text.slice(0, range[0])}
                  <mark ref={mark} className="rounded-sm bg-brand-sky/30 px-0.5 text-foreground">
                    {text.slice(range[0], range[1])}
                  </mark>
                  {text.slice(range[1])}
                </>
              ) : (
                text
              )}
            </p>
          )}
        </article>

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" className="min-h-11 min-w-0 gap-1.5" disabled={!previous} onClick={() => previous && onSelect(previous.unitIndex)}>
            <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{previous ? t("sources.pages.previous", { place: label(previous.label) }) : t("sources.pages.previousNone")}</span>
          </Button>
          <Button variant="outline" className="min-h-11 min-w-0 gap-1.5" disabled={!next} onClick={() => next && onSelect(next.unitIndex)}>
            <span className="truncate">{next ? t("sources.pages.next", { place: label(next.label) }) : t("sources.pages.nextNone")}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
