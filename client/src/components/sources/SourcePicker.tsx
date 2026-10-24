import { useId, useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/useMobile";
import { pickerLabel, type AskMode, type AskSourceSelection } from "@/lib/askSources";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

type Props = { courseId: number | undefined; selection: AskSourceSelection; onChange: (selection: AskSourceSelection) => void };

function Body({ courseId, selection, onChange, onDone, mobile }: Props & { onDone: () => void; mobile: boolean }) {
  const { t } = useI18n();
  const name = useId();
  const list = trpc.sources.list.useQuery({ courseId }, { enabled: courseId !== undefined });
  const ready = (list.data?.sources ?? []).filter(source => source.status === "ready");
  const allIds = ready.map(source => source.id);
  const checked = (id: number) => selection.mode !== "recordings" && (selection.ids.length === 0 || selection.ids.includes(id));

  const toggle = (id: number, on: boolean) => {
    const current = selection.mode === "recordings" ? [] : selection.ids.length === 0 ? allIds : selection.ids;
    const next = on ? Array.from(new Set([...current, id])) : current.filter(value => value !== id);
    if (next.length === 0) onChange({ ids: [], mode: "recordings" });
    else onChange({ ids: next.length === allIds.length ? [] : next, mode: selection.mode === "recordings" ? "both" : selection.mode });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <RadioGroup value={selection.mode} onValueChange={value => onChange({ ...selection, mode: value as AskMode })} aria-label={t("ask.sources.modeLabel")} className="gap-2">
        {(["both", "sources", "recordings"] as const).map(mode => (
          <div key={mode} className="flex min-h-9 items-center gap-2.5">
            <RadioGroupItem value={mode} id={`${name}-${mode}`} />
            <Label htmlFor={`${name}-${mode}`} className="cursor-pointer font-normal">
              {t(`ask.sources.mode.${mode}`)}
            </Label>
          </div>
        ))}
      </RadioGroup>

      <div className="min-h-0 flex-1 border-t border-border pt-3">
        {list.isLoading ? (
          <div className="space-y-2" aria-label={t("common.loading")}>
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <div role="alert" className="text-sm">
            <p className="text-destructive">{t("ask.sources.loadFailed")}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void list.refetch()}>
              {t("sources.retry")}
            </Button>
          </div>
        ) : ready.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("ask.sources.none")}{" "}
            {courseId !== undefined && (
              <Link href={`/courses/${courseId}/sources`} className="font-medium text-primary underline underline-offset-2">
                {t("ask.sources.addLink")}
              </Link>
            )}
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-1">
              <Button variant="ghost" size="sm" className="min-h-9" onClick={() => onChange({ ids: [], mode: selection.mode === "recordings" ? "both" : selection.mode })}>
                {t("ask.sources.selectAll")}
              </Button>
              <Button variant="ghost" size="sm" className="min-h-9" onClick={() => onChange({ ids: [], mode: "recordings" })}>
                {t("ask.sources.clear")}
              </Button>
            </div>
            <ul className={mobile ? "max-h-[40dvh] space-y-0.5 overflow-y-auto" : "max-h-64 space-y-0.5 overflow-y-auto"} aria-label={t("ask.sources.listLabel")}>
              {ready.map(source => (
                <li key={source.id}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-secondary">
                    <Checkbox checked={checked(source.id)} onCheckedChange={value => toggle(source.id, value === true)} />
                    <span className="min-w-0 truncate text-sm">{source.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {mobile && (
        <SheetFooter className="sticky bottom-0 bg-background pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="min-h-11 w-full" onClick={onDone}>
            {t("ask.sources.done")}
          </Button>
        </SheetFooter>
      )}
    </div>
  );
}

/**
 * Chooses which study sources Ask reads. A popover on desktop and a bottom sheet on a phone;
 * the choice lives in the page address, so a link can carry it and nothing is stored.
 */
export function SourcePicker(props: Props) {
  const { t, tn } = useI18n();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const list = trpc.sources.list.useQuery({ courseId: props.courseId }, { enabled: props.courseId !== undefined });
  const available = (list.data?.sources ?? []).filter(source => source.status === "ready").length;
  const label = pickerLabel(props.selection, available);
  const text =
    label.key === "all"
      ? t("ask.sources.triggerAll")
      : label.key === "some"
        ? tn("ask.sources.triggerSome", label.count)
        : label.key === "recordingsOnly"
          ? t("ask.sources.triggerRecordings")
          : t("ask.sources.triggerNone");

  const trigger = (
    <Button variant="outline" className="min-h-10 w-full justify-between gap-2 font-normal" aria-haspopup="dialog" aria-expanded={open} onClick={mobile ? () => setOpen(true) : undefined}>
      <span className="truncate">{text}</span>
      <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
    </Button>
  );

  if (mobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-3 rounded-t-2xl p-4">
            <SheetHeader className="p-0">
              <SheetTitle>{t("ask.sources.title")}</SheetTitle>
              <SheetDescription>{t("ask.sources.description")}</SheetDescription>
            </SheetHeader>
            <Body {...props} mobile onDone={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        <p className="text-sm font-medium">{t("ask.sources.title")}</p>
        <Body {...props} mobile={false} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
