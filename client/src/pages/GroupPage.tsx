import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Check, Copy, Loader2, MoreHorizontal, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CourseDot } from "@/components/CourseDot";
import { RoleSelect } from "@/components/RoleSelect";
import { formatRecordingDuration } from "@/lib/formatDuration";
import { trpc } from "@/lib/trpc";
import { GroupFormDialog } from "./Groups";
import type { ShareRole } from "@shared/sharing";
import { htmlLangFor } from "@shared/i18n";
import { getUiLanguage, t, Trans, useI18n } from "@/i18n";

/** "5 minutes ago" in the interface language. */
function ago(value: string | Date) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(htmlLangFor(getUiLanguage()), { numeric: "auto" });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}
const recordingHref = (recording: { id: number; mine: boolean }) => (recording.mine ? `/recording/${recording.id}` : `/shared-with-me/${recording.id}`);

function ShareToGroupDialog({ groupId, open, onOpenChange }: { groupId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  useI18n();
  const utils = trpc.useUtils();
  const [type, setType] = useState<"recording" | "course">("recording");
  const [itemId, setItemId] = useState("");
  const [role, setRole] = useState<ShareRole>("comment");
  const { data: recordings } = trpc.recordings.list.useQuery(undefined, { enabled: open });
  const { data: courses } = trpc.courses.list.useQuery(undefined, { enabled: open });
  const share = trpc.groups.share.useMutation({
    onSuccess: async () => {
      await utils.groups.get.invalidate({ groupId });
      toast.success(t("groups.share.done"));
      onOpenChange(false);
      setItemId("");
    },
    onError: error => toast.error(error.message),
  });
  const options =
    type === "recording"
      ? (recordings ?? []).filter(recording => recording.status === "completed").map(recording => ({ id: recording.id, label: recording.title }))
      : (courses ?? []).map(course => ({ id: course.id, label: course.name, color: course.color }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("groups.share.title")}</DialogTitle>
          <DialogDescription>{t("groups.share.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={type}
            onValueChange={value => {
              if (!value) return;
              setType(value as "recording" | "course");
              setItemId("");
            }}
            aria-label={t("groups.share.what")}
            className="w-full"
          >
            <ToggleGroupItem value="recording" className="flex-1">
              {t("groups.share.aRecording")}
            </ToggleGroupItem>
            <ToggleGroupItem value="course" className="flex-1">
              {t("groups.share.aCourse")}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="space-y-2">
            <Label htmlFor="group-share-item">{type === "recording" ? t("groups.share.recording") : t("groups.share.course")}</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="group-share-item" className="w-full">
                <SelectValue placeholder={options.length ? t("groups.share.choose") : type === "recording" ? t("groups.share.noRecordings") : t("groups.share.noCourses")} />
              </SelectTrigger>
              <SelectContent>
                {options.map(option => (
                  <SelectItem key={option.id} value={String(option.id)}>
                    <span className="flex items-center gap-2">
                      {"color" in option && <CourseDot color={option.color} />}
                      <span className="truncate">{option.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>{t("groups.share.membersCan")}</Label>
            <RoleSelect value={role} onChange={setRole} label={t("groups.share.whatMembersCan")} className="w-44" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("groups.cancel")}
          </Button>
          <Button disabled={!itemId || share.isPending} onClick={() => share.mutate({ groupId, itemType: type, itemId: Number(itemId), role })}>
            {share.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("groups.share.share")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinLink({ groupId, token }: { groupId: number; token: string | null }) {
  useI18n();
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);
  const setLink = trpc.groups.setJoinLink.useMutation({
    onSuccess: () => utils.groups.get.invalidate({ groupId }),
    onError: error => toast.error(error.message),
  });
  const url = token ? `${window.location.origin}/groups/join/${token}` : null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("groups.link.title")}</p>
      {url ? (
        <>
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <code className="flex-1 truncate text-xs">{url}</code>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label={t("groups.link.copy")}
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="flex gap-3 text-xs">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setLink.mutate({ groupId, enabled: true })}>
              {t("groups.link.new")}
            </button>
            <button type="button" className="font-medium text-muted-foreground hover:text-destructive hover:underline" onClick={() => setLink.mutate({ groupId, enabled: false })}>
              {t("groups.link.off")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("groups.link.hint")}</p>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setLink.mutate({ groupId, enabled: true })} disabled={setLink.isPending}>
          {t("groups.link.create")}
        </Button>
      )}
    </div>
  );
}

/** One study group (D2): what is shared, recent activity, and members. */
export default function GroupPage() {
  const { tn } = useI18n();
  const [, params] = useRoute("/groups/:id");
  const [, navigate] = useLocation();
  const groupId = params?.id && /^\d+$/.test(params.id) ? Number(params.id) : 0;
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.groups.get.useQuery({ groupId }, { enabled: groupId > 0, retry: false });
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  const refresh = () => utils.groups.get.invalidate({ groupId });
  const onError = (err: { message: string }) => toast.error(err.message);
  const invite = trpc.groups.invite.useMutation({
    onSuccess: async result => {
      toast.success(t("groups.page.added", { name: result.added }));
      setInviteEmail("");
      await refresh();
    },
    onError,
  });
  const removeMember = trpc.groups.removeMember.useMutation({ onSuccess: refresh, onError });
  const setShareRole = trpc.groups.setShareRole.useMutation({ onSuccess: refresh, onError });
  const unshare = trpc.groups.unshare.useMutation({ onSuccess: refresh, onError });
  const leave = trpc.groups.leave.useMutation({
    onSuccess: async () => {
      await utils.groups.list.invalidate();
      navigate("/groups");
    },
    onError,
  });
  const remove = trpc.groups.remove.useMutation({
    onSuccess: async () => {
      await utils.groups.list.invalidate();
      navigate("/groups");
    },
    onError,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium">{error?.message || t("groups.page.notFound")}</p>
        <Link href="/groups">
          <Button variant="outline">{t("groups.page.backToGroups")}</Button>
        </Link>
      </div>
    );
  }

  const isOwner = data.myRole === "owner";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href="/groups">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("groups.page.groups")}
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => setSharing(true)}>
              <Plus className="h-4 w-4" />
              {t("groups.share.share")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={t("groups.page.options")}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwner && <DropdownMenuItem onSelect={() => setEditing(true)}>{t("groups.page.edit")}</DropdownMenuItem>}
                {isOwner && <DropdownMenuSeparator />}
                {isOwner ? (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm("delete")}>
                    {t("groups.page.delete")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm("leave")}>
                    {t("groups.page.leave")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main-content" className="container max-w-5xl pb-20 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{data.group.name}</h1>
        {data.group.description && <p className="mt-2 max-w-2xl text-muted-foreground">{data.group.description}</p>}
        <p className="mt-2 text-sm text-muted-foreground">
          {tn("groups.page.meta", data.members.length, { when: ago(data.group.createdAt) })}
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-10">
            <section aria-labelledby="group-shared-heading">
              <h2 id="group-shared-heading" className="text-lg font-semibold">
                {t("groups.page.sharedHere")}
              </h2>
              {data.items.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <p className="text-sm text-muted-foreground">{t("groups.page.emptyShared")}</p>
                  <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => setSharing(true)}>
                    <Plus className="h-4 w-4" />
                    {t("groups.page.shareSomething")}
                  </Button>
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
                  {data.items.map(item => (
                    <li key={item.shareId} id={`group-item-${item.shareId}`} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          {item.type === "recording" ? (
                            <Link href={recordingHref(item.recording)} className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              {item.recording.title}
                            </Link>
                          ) : (
                            <p className="flex items-center gap-2 font-semibold">
                              <CourseDot color={item.course.color} />
                              {item.course.name}
                              <span className="text-xs font-normal text-muted-foreground">{t("groups.page.courseTag")}</span>
                            </p>
                          )}
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {t("groups.page.sharedBy", { name: item.sharedByName, when: ago(item.sharedAt) })} · {t(`groups.page.membersRole.${item.role}`)}
                            {item.type === "recording" && item.recording.duration ? ` · ${formatRecordingDuration(item.recording.duration)}` : ""}
                          </p>
                        </div>
                        {item.canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t("groups.page.itemOptions", { title: item.type === "recording" ? item.recording.title : item.course.name })}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {(["view", "comment", "edit"] as const).map(role => (
                                <DropdownMenuItem key={role} onSelect={() => setShareRole.mutate({ shareId: item.shareId, role })}>
                                  {role === item.role ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                                  {t(`groups.page.setRole.${role}`)}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => unshare.mutate({ shareId: item.shareId })}>
                                {t("groups.page.stopSharing")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {item.type === "course" && (
                        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                          {item.recordings.length === 0 ? (
                            <li className="text-sm text-muted-foreground">{t("groups.page.noCourseRecordings")}</li>
                          ) : (
                            item.recordings.map(recording => (
                              <li key={recording.id} className="flex items-baseline justify-between gap-3 text-sm">
                                <Link href={recordingHref(recording)} className="truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  {recording.title}
                                </Link>
                                <span className="shrink-0 tabular-nums text-muted-foreground">{formatRecordingDuration(recording.duration)}</span>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="group-activity-heading">
              <h2 id="group-activity-heading" className="text-lg font-semibold">
                {t("groups.page.activity")}
              </h2>
              {data.feed.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t("groups.page.activityEmpty")}</p>
              ) : (
                <ol className="mt-3 space-y-4">
                  {data.feed.map((entry, index) => (
                    <li key={`${entry.kind}-${index}`} className="text-sm">
                      <p>
                        <Trans
                          k={entry.kind === "shared" ? (entry.itemType === "course" ? "groups.feed.sharedCourse" : "groups.feed.shared") : entry.isReply ? "groups.feed.replied" : "groups.feed.commented"}
                          parts={{
                            actor: () => <span className="font-semibold">{entry.actor}</span>,
                            item: () => (
                              <Link href={entry.href} className="font-medium text-primary hover:underline">
                                {entry.title}
                              </Link>
                            ),
                            when: () => <span className="text-muted-foreground">{ago(entry.at)}</span>,
                          }}
                        />
                      </p>
                      {entry.kind === "comment" && (
                        <div className="mt-1.5 rounded-lg bg-muted/60 px-3 py-2">
                          <p className="line-clamp-1 text-xs text-muted-foreground">“{entry.quote}”</p>
                          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">{entry.body}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="space-y-8" aria-label={t("groups.page.members")}>
            <section>
              <h2 className="text-lg font-semibold">{t("groups.page.members")}</h2>
              <ul className="mt-3 space-y-2.5">
                {data.members.map(member => (
                  <li key={member.userId} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.role === "owner" ? t("groups.owner") : t("groups.page.joined", { when: ago(member.joinedAt) })}</p>
                    </div>
                    {isOwner && member.role !== "owner" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => removeMember.mutate({ groupId, userId: member.userId })}
                        aria-label={t("groups.page.removeName", { name: member.name })}
                      >
                        {t("groups.page.remove")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {isOwner && (
              <section className="space-y-5">
                <form
                  className="space-y-2"
                  onSubmit={event => {
                    event.preventDefault();
                    if (inviteEmail.trim()) invite.mutate({ groupId, email: inviteEmail.trim() });
                  }}
                >
                  <Label htmlFor="group-invite" className="text-sm font-medium">
                    {t("groups.page.addByEmail")}
                  </Label>
                  <div className="flex gap-2">
                    <Input id="group-invite" type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder={t("share.emailPlaceholder")} className="h-9" />
                    <Button type="submit" size="sm" className="h-9" disabled={!inviteEmail.trim() || invite.isPending}>
                      {t("groups.page.add")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("groups.page.addHint")}</p>
                </form>
                <JoinLink groupId={groupId} token={data.group.joinToken} />
              </section>
            )}
          </aside>
        </div>
      </main>

      <ShareToGroupDialog groupId={groupId} open={sharing} onOpenChange={setSharing} />
      {isOwner && (
        <GroupFormDialog open={editing} onOpenChange={setEditing} initial={{ groupId, name: data.group.name, description: data.group.description }} />
      )}
      <AlertDialog open={confirm !== null} onOpenChange={open => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? t("groups.page.deleteTitle") : t("groups.page.leaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? t("groups.page.deleteBody")
                : t("groups.page.leaveBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("groups.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => (confirm === "delete" ? remove.mutate({ groupId }) : leave.mutate({ groupId }))}
            >
              {confirm === "delete" ? t("groups.page.delete") : t("groups.page.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
