import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { RoleSelect } from "@/components/RoleSelect";
import { Link2, Copy, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { ShareRole } from "@shared/sharing";
import { Trans, useI18n } from "@/i18n";

function SectionHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2.5">
      <h3 className="text-sm font-semibold">{children}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function GroupShares({ recordingId, open }: { recordingId: number; open: boolean }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data } = trpc.groups.forRecording.useQuery({ recordingId }, { enabled: open });
  const [roles, setRoles] = useState<Record<number, ShareRole>>({});
  const refresh = () => utils.groups.forRecording.invalidate({ recordingId });
  const onError = (error: { message: string }) => toast.error(error.message);
  const share = trpc.groups.share.useMutation({ onSuccess: refresh, onError });
  const setRole = trpc.groups.setShareRole.useMutation({ onSuccess: refresh, onError });
  const unshare = trpc.groups.unshare.useMutation({ onSuccess: refresh, onError });

  if (!data) return null;
  if (!data.available) return null;

  return (
    <section>
      <SectionHeading hint={t("share.groupsHint")}>{t("share.groups")}</SectionHeading>
      {data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans k="share.noGroups" parts={{ link: text => <Link href="/groups" className="font-medium text-primary hover:underline">{text}</Link> }} />
        </p>
      ) : (
        <ul className="space-y-2">
          {data.groups.map(group => (
            <li key={group.id} className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <p className="truncate text-sm font-medium">{group.name}</p>
                {group.viaCourseRole && !group.shareId && (
                  <p className="text-xs text-muted-foreground">{t("share.viaCourse", { role: t(`share.role.${group.viaCourseRole}`) })}</p>
                )}
              </div>
              {group.shareId ? (
                <>
                  <RoleSelect
                    value={group.role ?? "view"}
                    label={t("share.accessFor", { name: group.name })}
                    disabled={setRole.isPending}
                    onChange={role => setRole.mutate({ shareId: group.shareId!, role })}
                  />
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label={t("share.stopSharing", { name: group.name })} disabled={unshare.isPending} onClick={() => unshare.mutate({ shareId: group.shareId! })}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <RoleSelect value={roles[group.id] ?? "comment"} label={t("share.accessFor", { name: group.name })} onChange={role => setRoles(current => ({ ...current, [group.id]: role }))} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0"
                    disabled={share.isPending}
                    onClick={() => share.mutate({ groupId: group.id, itemType: "recording", itemId: recordingId, role: roles[group.id] ?? "comment" }, { onSuccess: () => toast.success(t("share.sharedWith", { name: group.name })) })}
                  >
                    {t("share.share")}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ShareRecordingDialog({
  recordingId,
  open,
  onOpenChange,
}: {
  recordingId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("view");
  const [copied, setCopied] = useState(false);
  const utils = trpc.useUtils();

  const { data: shareState, isLoading } = trpc.sharing.getShareState.useQuery({ recordingId }, { enabled: open });

  const invalidate = () => utils.sharing.getShareState.invalidate({ recordingId });
  const onError = (err: { message: string }) => toast.error(err.message);

  const enableLink = trpc.sharing.enablePublicLink.useMutation({ onSuccess: invalidate, onError });
  const disableLink = trpc.sharing.disablePublicLink.useMutation({ onSuccess: invalidate, onError });
  const shareWithUser = trpc.sharing.shareWithUser.useMutation({
    onSuccess: data => {
      toast.success(t("share.sharedWith", { name: data.sharedWithEmail }));
      setEmail("");
      invalidate();
    },
    onError,
  });
  const setShareRole = trpc.sharing.setShareRole.useMutation({ onSuccess: invalidate, onError });
  const unshareWithUser = trpc.sharing.unshareWithUser.useMutation({ onSuccess: invalidate, onError });

  const shareUrl = shareState?.publicShareToken ? `${window.location.origin}/shared/${shareState.publicShareToken}` : null;

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("share.linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWithUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    shareWithUser.mutate({ recordingId, email: email.trim(), role });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-1">
            <section>
              <SectionHeading hint={t("share.peopleHint")}>{t("share.people")}</SectionHeading>
              <form onSubmit={handleShareWithUser} className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  placeholder={t("share.emailPlaceholder")}
                  aria-label={t("share.emailLabel")}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-9 flex-1"
                />
                <div className="flex gap-2">
                  <RoleSelect value={role} onChange={setRole} label={t("share.accessForNew")} className="flex-1 sm:flex-none" />
                  <Button type="submit" size="sm" className="h-9" disabled={shareWithUser.isPending || !email.trim()}>
                    {shareWithUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("share.share")}
                  </Button>
                </div>
              </form>

              {shareState && shareState.shares.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {shareState.shares.map(share => (
                    <li key={share.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{share.sharedWithEmail}</span>
                      <RoleSelect
                        value={share.role}
                        label={t("share.accessFor", { name: share.sharedWithEmail })}
                        disabled={setShareRole.isPending}
                        onChange={next => setShareRole.mutate({ recordingId, sharedWithUserId: share.sharedWithUserId, role: next })}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 shrink-0"
                        aria-label={t("share.stopSharing", { name: share.sharedWithEmail })}
                        disabled={unshareWithUser.isPending}
                        onClick={() => unshareWithUser.mutate({ recordingId, sharedWithUserId: share.sharedWithUserId })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />
            <GroupShares recordingId={recordingId} open={open} />
            <Separator />

            <section>
              <SectionHeading hint={t("share.linkHint")}>{t("share.anyoneWithLink")}</SectionHeading>
              {shareUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                    <code className="flex-1 truncate text-xs">{shareUrl}</code>
                    <Button size="sm" variant="ghost" onClick={copyLink} className="h-7 w-7 shrink-0 p-0" aria-label={t("share.copyLink")}>
                      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={disableLink.isPending} onClick={() => disableLink.mutate({ recordingId })}>
                    {t("share.turnOffLink")}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={enableLink.isPending} onClick={() => enableLink.mutate({ recordingId })}>
                  {enableLink.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                  {t("share.createLink")}
                </Button>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
