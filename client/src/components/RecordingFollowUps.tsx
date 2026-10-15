import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { localIsoDate } from "@shared/actionItems";
import { useI18n } from "@/i18n";
import { htmlLangFor, type MessageKey } from "@shared/i18n";

/** "Today", "Tomorrow", "In 3 days", "4 days ago" in the interface language. Both dates are zone-less YYYY-MM-DD. */
function followUpDay(dueDate: string, todayIso: string, language: Parameters<typeof htmlLangFor>[0]) {
  const locale = htmlLangFor(language);
  const [y1, m1, d1] = todayIso.split("-").map(Number);
  const [y2, m2, d2] = dueDate.split("-").map(Number);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  const text = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

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
  const { t, language } = useI18n();
  const utils = trpc.useUtils();
  const today = localIsoDate(new Date());
  const { data, isLoading } = trpc.followUps.list.useQuery({ recordingId }, { enabled: recordingId > 0 });
  const refresh = () => utils.followUps.list.invalidate({ recordingId });

  const generate = trpc.followUps.generate.useMutation({
    onSuccess: () => void refresh(),
    onError: error => toast.error(error.message || t("followUps.planFailed")),
  });
  const update = trpc.followUps.update.useMutation({ onSuccess: () => void refresh(), onError: error => toast.error(error.message || t("followUps.updateFailed")) });
  const remove = trpc.followUps.remove.useMutation({ onSuccess: () => void refresh(), onError: error => toast.error(error.message || t("followUps.removeFailed")) });

  const items = data?.items ?? [];
  const open = items.filter(item => !item.done).length;
  const meeting = audience === "professional";

  return (
    <section aria-labelledby="follow-ups-heading" className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="follow-ups-heading" className="font-semibold">{t("followUps.title")}</h3>
        {items.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{t("followUps.toDo", { count: open })}</span>}
      </div>

      {isLoading ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : data && !data.available ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("followUps.unavailable")}</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {transcriptReady
                ? meeting
                  ? t("followUps.introMeeting")
                  : t("followUps.introClass")
                : t("tasks.waitTranscript")}
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
                        <span className={cn(due && "font-medium text-primary")}>{followUpDay(item.dueDate, today, language)}</span>
                        <span>{t(`followUps.kind.${item.kind}` as MessageKey)}</span>
                        {item.kind === "practice" && !done && flashcardCount > 0 && (
                          <button
                            type="button"
                            onClick={onOpenFlashcards}
                            className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {t("followUps.reviewCards")}
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
                      aria-label={t("followUps.remove", { title: item.title })}
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
                {generate.isPending ? t("followUps.planning") : items.length ? t("followUps.planAgain") : t("followUps.plan")}
              </Button>
            </div>
          )}
          {items.length > 0 && data?.reminders && (
            <p className="mt-2 text-xs text-muted-foreground">{t("followUps.reminderNote")}</p>
          )}
        </>
      )}
    </section>
  );
}
