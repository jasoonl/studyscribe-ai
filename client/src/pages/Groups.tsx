import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { htmlLangFor } from "@shared/i18n";
import { getUiLanguage, useI18n } from "@/i18n";

/** "5 minutes ago" in the interface language. */
function ago(value: string | Date) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(htmlLangFor(getUiLanguage()), { numeric: "auto" });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}

export function GroupFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { groupId: number; name: string; description: string | null };
  onSaved?: (groupId: number) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const utils = trpc.useUtils();
  const create = trpc.groups.create.useMutation();
  const update = trpc.groups.update.useMutation();
  const pending = create.isPending || update.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      let id = initial?.groupId;
      if (initial) await update.mutateAsync({ groupId: initial.groupId, name, description });
      else id = (await create.mutateAsync({ name, description })).id;
      await Promise.all([utils.groups.list.invalidate(), id ? utils.groups.get.invalidate({ groupId: id }) : undefined]);
      onOpenChange(false);
      if (id) onSaved?.(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("groups.form.saveFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (next) {
          setName(initial?.name ?? "");
          setDescription(initial?.description ?? "");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{initial ? t("groups.form.editTitle") : t("groups.form.newTitle")}</DialogTitle>
            <DialogDescription>{t("groups.form.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="group-name">{t("groups.form.name")}</Label>
            <Input id="group-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder={t("groups.form.namePlaceholder")} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-description">{t("groups.form.about")}</Label>
            <Textarea id="group-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} placeholder={t("groups.form.aboutPlaceholder")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("groups.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : initial ? t("groups.form.save") : t("groups.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Study groups (D2): the groups you are in. */
export default function Groups() {
  const { t, tn } = useI18n();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = trpc.groups.list.useQuery();
  const groups = data?.groups ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("common.library")}
            </Button>
          </Link>
          {data?.available !== false && (
            <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t("groups.new")}
            </Button>
          )}
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("groups.title")}</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          {t("groups.intro")}
        </p>

        <div className="mt-8">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-7 w-7 animate-spin text-accent" />
            </div>
          ) : data && !data.available ? (
            <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">{t("groups.unavailable")}</p>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
              <p className="mx-auto max-w-md text-muted-foreground">
                {t("groups.empty")}
              </p>
              <Button variant="outline" className="mt-5 gap-2" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                {t("groups.new")}
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
              {groups.map(group => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{group.name}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                        <span>{tn("groups.members", group.memberCount)}</span>
                        <span>{tn("groups.items", group.itemCount)}</span>
                        {group.lastSharedAt && <span>{t("groups.lastShare", { when: ago(group.lastSharedAt) })}</span>}
                      </p>
                    </div>
                    {group.role === "owner" && <span className="shrink-0 text-xs font-medium text-muted-foreground">{t("groups.owner")}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <GroupFormDialog open={creating} onOpenChange={setCreating} onSaved={id => navigate(`/groups/${id}`)} />
    </div>
  );
}
