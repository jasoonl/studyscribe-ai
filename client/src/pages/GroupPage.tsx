import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { formatDistanceToNow } from "date-fns";
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
import { RoleSelect, roleLabel } from "@/components/RoleSelect";
import { formatRecordingDuration } from "@/lib/formatDuration";
import { trpc } from "@/lib/trpc";
import { GroupFormDialog } from "./Groups";
import type { ShareRole } from "@shared/sharing";

const ago = (value: string | Date) => formatDistanceToNow(new Date(value), { addSuffix: true });
const recordingHref = (recording: { id: number; mine: boolean }) => (recording.mine ? `/recording/${recording.id}` : `/shared-with-me/${recording.id}`);

function ShareToGroupDialog({ groupId, open, onOpenChange }: { groupId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const [type, setType] = useState<"recording" | "course">("recording");
  const [itemId, setItemId] = useState("");
  const [role, setRole] = useState<ShareRole>("comment");
  const { data: recordings } = trpc.recordings.list.useQuery(undefined, { enabled: open });
  const { data: courses } = trpc.courses.list.useQuery(undefined, { enabled: open });
  const share = trpc.groups.share.useMutation({
    onSuccess: async () => {
      await utils.groups.get.invalidate({ groupId });
      toast.success("Shared with the group");
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
          <DialogTitle>Share with the group</DialogTitle>
          <DialogDescription>A course share includes every recording in the course, and ones you add to it later.</DialogDescription>
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
            aria-label="What to share"
            className="w-full"
          >
            <ToggleGroupItem value="recording" className="flex-1">
              A recording
            </ToggleGroupItem>
            <ToggleGroupItem value="course" className="flex-1">
              A course
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="space-y-2">
            <Label htmlFor="group-share-item">{type === "recording" ? "Recording" : "Course"}</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="group-share-item" className="w-full">
                <SelectValue placeholder={options.length ? "Choose one" : type === "recording" ? "No finished recordings yet" : "No courses yet"} />
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
            <Label>Members can</Label>
            <RoleSelect value={role} onChange={setRole} label="What members can do" className="w-44" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!itemId || share.isPending} onClick={() => share.mutate({ groupId, itemType: type, itemId: Number(itemId), role })}>
            {share.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinLink({ groupId, token }: { groupId: number; token: string | null }) {
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);
  const setLink = trpc.groups.setJoinLink.useMutation({
    onSuccess: () => utils.groups.get.invalidate({ groupId }),
    onError: error => toast.error(error.message),
  });
  const url = token ? `${window.location.origin}/groups/join/${token}` : null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Join link</p>
      {url ? (
        <>
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <code className="flex-1 truncate text-xs">{url}</code>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label="Copy join link"
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
              Make a new link
            </button>
            <button type="button" className="font-medium text-muted-foreground hover:text-destructive hover:underline" onClick={() => setLink.mutate({ groupId, enabled: false })}>
              Turn off
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Anyone signed in with the link can join. A new link stops the old one working.</p>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setLink.mutate({ groupId, enabled: true })} disabled={setLink.isPending}>
          Create a join link
        </Button>
      )}
    </div>
  );
}

/** One study group (D2): what is shared, recent activity, and members. */
export default function GroupPage() {
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
      toast.success(`Added ${result.added}`);
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
        <p className="text-lg font-medium">{error?.message || "Group not found"}</p>
        <Link href="/groups">
          <Button variant="outline">Back to groups</Button>
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
              Groups
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => setSharing(true)}>
              <Plus className="h-4 w-4" />
              Share
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Group options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwner && <DropdownMenuItem onSelect={() => setEditing(true)}>Edit name and about</DropdownMenuItem>}
                {isOwner && <DropdownMenuSeparator />}
                {isOwner ? (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm("delete")}>
                    Delete group
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm("leave")}>
                    Leave group
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
          {data.members.length} member{data.members.length === 1 ? "" : "s"} · started {ago(data.group.createdAt)}
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-10">
            <section aria-labelledby="group-shared-heading">
              <h2 id="group-shared-heading" className="text-lg font-semibold">
                Shared here
              </h2>
              {data.items.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <p className="text-sm text-muted-foreground">Nothing shared yet. Share a lecture or a whole course so everyone can listen, read and comment.</p>
                  <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => setSharing(true)}>
                    <Plus className="h-4 w-4" />
                    Share something
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
                              <span className="text-xs font-normal text-muted-foreground">course</span>
                            </p>
                          )}
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {item.sharedByName} shared it {ago(item.sharedAt)} · members {roleLabel(item.role).toLowerCase()}
                            {item.type === "recording" && item.recording.duration ? ` · ${formatRecordingDuration(item.recording.duration)}` : ""}
                          </p>
                        </div>
                        {item.canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Options for ${item.type === "recording" ? item.recording.title : item.course.name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {(["view", "comment", "edit"] as const).map(role => (
                                <DropdownMenuItem key={role} onSelect={() => setShareRole.mutate({ shareId: item.shareId, role })}>
                                  {role === item.role ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                                  Members {roleLabel(role).toLowerCase()}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => unshare.mutate({ shareId: item.shareId })}>
                                Stop sharing
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {item.type === "course" && (
                        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                          {item.recordings.length === 0 ? (
                            <li className="text-sm text-muted-foreground">No recordings in this course yet.</li>
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
                Recent activity
              </h2>
              {data.feed.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Shares and transcript comments will show up here.</p>
              ) : (
                <ol className="mt-3 space-y-4">
                  {data.feed.map((entry, index) => (
                    <li key={`${entry.kind}-${index}`} className="text-sm">
                      <p>
                        <span className="font-semibold">{entry.actor}</span>{" "}
                        {entry.kind === "shared" ? (
                          <>
                            shared {entry.itemType === "course" ? "the course " : ""}
                            <Link href={entry.href} className="font-medium text-primary hover:underline">
                              {entry.title}
                            </Link>
                          </>
                        ) : (
                          <>
                            {entry.isReply ? "replied on " : "commented on "}
                            <Link href={entry.href} className="font-medium text-primary hover:underline">
                              {entry.title}
                            </Link>
                          </>
                        )}{" "}
                        <span className="text-muted-foreground">{ago(entry.at)}</span>
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

          <aside className="space-y-8" aria-label="Members">
            <section>
              <h2 className="text-lg font-semibold">Members</h2>
              <ul className="mt-3 space-y-2.5">
                {data.members.map(member => (
                  <li key={member.userId} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.role === "owner" ? "Owner" : `Joined ${ago(member.joinedAt)}`}</p>
                    </div>
                    {isOwner && member.role !== "owner" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => removeMember.mutate({ groupId, userId: member.userId })}
                        aria-label={`Remove ${member.name}`}
                      >
                        Remove
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
                    Add by email
                  </Label>
                  <div className="flex gap-2">
                    <Input id="group-invite" type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="classmate@example.com" className="h-9" />
                    <Button type="submit" size="sm" className="h-9" disabled={!inviteEmail.trim() || invite.isPending}>
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">For people who already have a StudyScribe account.</p>
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
            <AlertDialogTitle>{confirm === "delete" ? "Delete this group?" : "Leave this group?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "Members lose access to everything shared through it. The recordings themselves are not deleted."
                : "You lose access to what others shared here, and what you shared stops being shared with the group."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => (confirm === "delete" ? remove.mutate({ groupId }) : leave.mutate({ groupId }))}
            >
              {confirm === "delete" ? "Delete group" : "Leave group"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
