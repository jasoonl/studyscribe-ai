import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Copy, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { orgCan, type OrgRole } from "@shared/organizations";
import { htmlLangFor } from "@shared/i18n";
import { formatDate, formatNumber, getUiLanguage, t, tn, Trans, useI18n } from "@/i18n";

/** "5 minutes ago" or "in 13 days" in the interface language. */
function ago(value: string | Date) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(htmlLangFor(getUiLanguage()), { numeric: "auto" });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}

const roleName = (role: OrgRole) => t(`team.role.${role}`);
const usd = (value: number) => formatNumber(value, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

function SectionHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function CreateTeam() {
  useI18n();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const create = trpc.teams.create.useMutation({
    onSuccess: async () => {
      toast.success(t("team.created"));
      await utils.teams.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  return (
    <Card className="gap-0 p-6">
      <SectionHeading title={t("team.start.title")} description={t("team.start.description")} />
      <form
        className="mt-5 flex flex-col gap-3 sm:flex-row"
        onSubmit={event => {
          event.preventDefault();
          create.mutate({ name: name.trim() });
        }}
      >
        <Label htmlFor="team-name" className="sr-only">{t("team.teamName")}</Label>
        <Input id="team-name" value={name} onChange={event => setName(event.target.value)} placeholder={t("team.start.placeholder")} maxLength={120} className="sm:max-w-sm" />
        <Button type="submit" disabled={name.trim().length < 2 || create.isPending}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("team.start.create")}
        </Button>
      </form>
    </Card>
  );
}

function Library({ role }: { role: OrgRole }) {
  useI18n();
  const utils = trpc.useUtils();
  const library = trpc.teams.library.useQuery();
  const mine = trpc.teams.myCourses.useQuery();
  const [adding, setAdding] = useState<string>("");
  const refresh = () => Promise.all([utils.teams.library.invalidate(), utils.teams.myCourses.invalidate()]);
  const share = trpc.teams.shareCourse.useMutation({ onSuccess: async () => { setAdding(""); await refresh(); toast.success(t("team.library.added")); }, onError: error => toast.error(error.message) });
  const unshare = trpc.teams.unshareCourse.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const addable = (mine.data ?? []).filter(course => !course.inLibrary);

  return (
    <Card className="gap-0 p-6">
      <SectionHeading title={t("team.library.title")} description={t("team.library.description")} />
      <div className="mt-5 space-y-4">
        {library.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (library.data ?? []).length === 0 ? (
          <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t("team.library.empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {library.data!.map(course => (
              <li key={course.courseId} className="flex items-center gap-3 px-4 py-3">
                <CourseDot color={course.color} />
                <Link href={`/team/courses/${course.courseId}`} className="min-w-0 flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="block truncate text-sm font-medium hover:underline">{course.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {tn("team.library.recordings", course.recordings)} · {course.yours ? t("team.library.yours") : t("team.library.sharedBy", { name: course.sharedByName })}
                  </span>
                </Link>
                {course.canRemove && (
                  <Button size="sm" variant="ghost" disabled={unshare.isPending} onClick={() => unshare.mutate({ courseId: course.courseId })}>
                    {t("team.remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Label htmlFor="team-add-course" className="sr-only">{t("team.library.courseToShare")}</Label>
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger id="team-add-course" className="sm:w-72"><SelectValue placeholder={t("team.library.choose")} /></SelectTrigger>
              <SelectContent>
                {addable.map(course => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!adding || share.isPending} onClick={() => share.mutate({ courseId: Number(adding) })}>{t("team.library.add")}</Button>
          </div>
        )}
        {role === "member" && <p className="text-xs text-muted-foreground">{t("team.library.readOnly")}</p>}
      </div>
    </Card>
  );
}

function Members({ role, seats }: { role: OrgRole; seats: { limited: boolean; used: number; total: number | null; available: number | null } | null }) {
  useI18n();
  const utils = trpc.useUtils();
  const members = trpc.teams.members.useQuery();
  const invites = trpc.teams.invites.useQuery(undefined, { enabled: orgCan(role, "invite") });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const [transferTo, setTransferTo] = useState<{ userId: number; name: string } | null>(null);
  const refresh = () => Promise.all([utils.teams.members.invalidate(), utils.teams.invites.invalidate(), utils.teams.mine.invalidate()]);
  const onError = (error: { message: string }) => toast.error(error.message);
  const invite = trpc.teams.invite.useMutation({ onSuccess: async result => { setLink({ url: result.link, emailed: result.emailed }); setEmail(""); await refresh(); }, onError });
  const revoke = trpc.teams.revokeInvite.useMutation({ onSuccess: refresh, onError });
  const setRole = trpc.teams.setRole.useMutation({ onSuccess: refresh, onError });
  const remove = trpc.teams.removeMember.useMutation({ onSuccess: async () => { toast.success(t("team.members.removed")); await refresh(); }, onError });
  const transfer = trpc.teams.transferOwnership.useMutation({ onSuccess: async () => { setTransferTo(null); toast.success(t("team.members.transferred")); await refresh(); }, onError });
  const showUsage = orgCan(role, "view_usage");

  return (
    <Card className="gap-0 p-6">
      <SectionHeading
        title={t("team.members.title")}
        description={seats?.limited ? t("team.members.seats", { used: formatNumber(seats.used), total: formatNumber(seats.total ?? 0) }) : t("team.members.unlimited")}
      />
      <div className="relative mt-5 min-w-0 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t("team.members.person")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("team.members.role")}</th>
              {showUsage && <th scope="col" className="px-4 py-2 text-right font-medium">{t("team.members.minutes")}</th>}
              {showUsage && <th scope="col" className="px-4 py-2 text-right font-medium">{t("team.members.aiUses")}</th>}
              {showUsage && <th scope="col" className="px-4 py-2 font-medium">{t("team.members.lastActive")}</th>}
              <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{t("team.members.actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(members.data ?? []).map(member => {
              const canAct = !member.isYou && member.role !== "owner" && (role === "owner" || (role === "admin" && member.role === "member"));
              return (
                <tr key={member.userId}>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{member.name || member.email}{member.isYou && <span className="font-normal text-muted-foreground"> {t("team.members.you")}</span>}</span>
                    {member.name && <span className="block text-xs text-muted-foreground">{member.email}</span>}
                  </td>
                  <td className="px-4 py-3">{roleName(member.role)}</td>
                  {showUsage && <td className="px-4 py-3 text-right tabular-nums">{formatNumber(member.usage?.minutes ?? 0)}</td>}
                  {showUsage && <td className="px-4 py-3 text-right tabular-nums">{formatNumber(member.usage?.generations ?? 0)}</td>}
                  {showUsage && <td className="px-4 py-3 text-muted-foreground">{member.lastActive ? ago(member.lastActive) : t("team.members.never")}</td>}
                  <td className="px-2 py-3">
                    {canAct && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("team.members.options", { name: member.name || member.email })}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {role === "owner" && (
                            <DropdownMenuItem onSelect={() => setRole.mutate({ userId: member.userId, role: member.role === "admin" ? "member" : "admin" })}>
                              {member.role === "admin" ? t("team.members.makeMember") : t("team.members.makeAdmin")}
                            </DropdownMenuItem>
                          )}
                          {role === "owner" && <DropdownMenuItem onSelect={() => setTransferTo({ userId: member.userId, name: member.name || member.email })}>{t("team.members.makeOwner")}</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => remove.mutate({ userId: member.userId })}>{t("team.members.removeFromTeam")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {orgCan(role, "invite") && (
        <div className="mt-6 space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={event => {
              event.preventDefault();
              invite.mutate({ email: email.trim(), role: inviteRole });
            }}
          >
            <Label htmlFor="invite-email" className="sr-only">{t("team.invite.emailLabel")}</Label>
            <Input id="invite-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@school.edu" className="sm:flex-1" />
            <Label htmlFor="invite-role" className="sr-only">{t("team.members.role")}</Label>
            <Select value={inviteRole} onValueChange={value => setInviteRole(value as "member" | "admin")}>
              <SelectTrigger id="invite-role" className="sm:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{roleName("member")}</SelectItem>
                <SelectItem value="admin">{roleName("admin")}</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!email.trim() || invite.isPending}>{invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("team.invite.submit")}</Button>
          </form>
          {(invites.data ?? []).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("team.invite.pending")}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {invites.data!.map(item => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item.email} <span className="text-muted-foreground">· {t("team.invite.meta", { role: roleName(item.role), when: ago(item.expiresAt) })}</span></span>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: item.id })}>{t("team.invite.revoke")}</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Dialog open={link !== null} onOpenChange={open => !open && setLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("team.invite.readyTitle")}</DialogTitle>
            <DialogDescription>{link?.emailed ? t("team.invite.readyEmailed") : t("team.invite.readyManual")}</DialogDescription>
          </DialogHeader>
          {link && <CopyField value={link.url} label={t("team.invite.copyLink")} />}
          <DialogFooter><Button onClick={() => setLink(null)}>{t("team.done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferTo !== null} onOpenChange={open => !open && setTransferTo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("team.transfer.title", { name: transferTo?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("team.transfer.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTo(null)}>{t("team.cancel")}</Button>
            <Button disabled={transfer.isPending} onClick={() => transferTo && transfer.mutate({ userId: transferTo.userId })}>{t("team.transfer.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Usage() {
  useI18n();
  const usage = trpc.teams.usage.useQuery();
  if (!usage.data) return null;
  const items = [
    { label: t("team.members.title"), value: usage.data.members },
    { label: t("team.usage.minutes"), value: usage.data.minutes },
    { label: t("team.usage.generations"), value: usage.data.generations },
    { label: t("team.usage.recordings"), value: usage.data.recordings },
  ];
  return (
    <Card className="gap-0 p-6">
      <SectionHeading title={t("team.usage.title")} description={t("team.usage.description", { plan: usage.data.perMember.planName, minutes: formatNumber(usage.data.perMember.minutes), generations: formatNumber(usage.data.perMember.generations) })} />
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {items.map(item => (
          <div key={item.label}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{formatNumber(item.value)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

type Mine = inferRouterOutputs<AppRouter>["teams"]["mine"];
type Org = NonNullable<Mine["org"]>;

function Billing({ org, mine }: { org: Org; mine: Mine }) {
  useI18n();
  const utils = trpc.useUtils();
  const used = mine.seats?.used ?? 1;
  const [seats, setSeats] = useState(String(Math.max(used, org.subscription.seats || used)));
  useEffect(() => setSeats(String(Math.max(used, org.subscription.seats || used))), [used, org.subscription.seats]);
  const onError = (error: { message: string }) => toast.error(error.message);
  const checkout = trpc.teams.checkout.useMutation({ onSuccess: result => window.location.assign(result.url), onError });
  const portal = trpc.teams.portal.useMutation({ onSuccess: result => window.location.assign(result.url), onError });
  const setSeatCount = trpc.teams.setSeats.useMutation({ onSuccess: async result => { toast.success(tn("team.billing.seatsSet", result.seats)); await utils.teams.mine.invalidate(); }, onError });
  const count = Number(seats);
  const valid = Number.isInteger(count) && count >= used && count <= 1000;

  return (
    <Card className="gap-0 p-6">
      <SectionHeading
        title={t("team.billing.title")}
        description={t("team.billing.description", { price: usd(mine.plan.priceMonthlyUsd), minutes: formatNumber(mine.plan.transcriptionMinutesPerMonth), generations: formatNumber(mine.plan.aiGenerationsPerMonth) })}
      />
      {!mine.billingConfigured ? (
        <p className="mt-5 rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t("team.billing.notOnSale")}</p>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="text-sm">
            {org.subscription.active
              ? org.subscription.currentPeriodEnd
                ? tn(org.subscription.cancelAtPeriodEnd ? "team.billing.activeEnds" : "team.billing.activeRenews", org.subscription.seats, { date: formatDate(org.subscription.currentPeriodEnd, { month: "long", day: "numeric" }) })
                : tn("team.billing.active", org.subscription.seats)
              : org.subscription.status === "past_due"
                ? t("team.billing.pastDue")
                : t("team.billing.notStarted")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="team-seats">{t("team.billing.seats")}</Label>
              <Input id="team-seats" type="number" inputMode="numeric" min={used} max={1000} value={seats} onChange={event => setSeats(event.target.value)} className="w-28" />
            </div>
            {org.subscription.active ? (
              <Button variant="outline" disabled={!valid || count === org.subscription.seats || setSeatCount.isPending} onClick={() => setSeatCount.mutate({ seats: count })}>
                {setSeatCount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("team.billing.changeSeats")}
              </Button>
            ) : (
              <Button disabled={!valid || checkout.isPending} onClick={() => checkout.mutate({ seats: count })}>
                {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("team.billing.start", { price: usd(mine.plan.priceMonthlyUsd * (valid ? count : 0)) })}
              </Button>
            )}
            {org.subscription.status !== "none" && (
              <Button variant="ghost" disabled={portal.isPending} onClick={() => portal.mutate()}>{t("team.billing.portal")}</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{tn("team.billing.prorated", used)}</p>
        </div>
      )}
    </Card>
  );
}

function SignIn({ org, mine }: { org: Org; mine: Mine }) {
  useI18n();
  const utils = trpc.useUtils();
  const [domain, setDomain] = useState("");
  const onError = (error: { message: string }) => toast.error(error.message);
  const refresh = () => utils.teams.mine.invalidate();
  const start = trpc.teams.startDomainVerification.useMutation({ onSuccess: refresh, onError });
  const check = trpc.teams.checkDomain.useMutation({ onSuccess: async result => { (result.verified ? toast.success : toast.info)(result.message); await refresh(); }, onError });
  const options = trpc.teams.setDomainOptions.useMutation({ onSuccess: refresh, onError });
  const removeDomain = trpc.teams.removeDomain.useMutation({ onSuccess: refresh, onError });
  const portal = trpc.teams.ssoPortal.useMutation({ onSuccess: result => window.open(result.url, "_blank", "noopener"), onError });
  const ssoOnly = trpc.teams.setSsoOnly.useMutation({
    onSuccess: async result => {
      toast.success(result.required ? t("team.sso.requiredOn") : t("team.sso.requiredOff"));
      await refresh();
    },
    onError,
  });

  return (
    <Card className="gap-0 p-6">
      <SectionHeading title={t("team.domain.title")} description={t("team.domain.description")} />
      <div className="mt-5 space-y-5">
        {org.verifiedDomain ? (
          <>
            <p className="text-sm"><Trans k="team.domain.verified" vars={{ domain: org.verifiedDomain }} parts={{ strong: text => <span className="font-medium">{text}</span> }} /></p>
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="team-autojoin" className="text-sm font-medium">{t("team.domain.autoJoin", { domain: org.verifiedDomain })}</Label>
                <p className="mt-0.5 text-sm text-muted-foreground">{t("team.domain.autoJoinHint")}</p>
              </div>
              <Switch id="team-autojoin" checked={org.autoJoin} onCheckedChange={autoJoin => options.mutate({ autoJoin, restrictToDomain: org.restrictToDomain })} />
            </div>
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="team-restrict" className="text-sm font-medium">{t("team.domain.restrict", { domain: org.verifiedDomain })}</Label>
                <p className="mt-0.5 text-sm text-muted-foreground">{t("team.domain.restrictHint")}</p>
              </div>
              <Switch id="team-restrict" checked={org.restrictToDomain} onCheckedChange={restrictToDomain => options.mutate({ autoJoin: org.autoJoin, restrictToDomain })} />
            </div>
            <Button variant="ghost" size="sm" className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => removeDomain.mutate()}>{t("team.domain.remove")}</Button>
          </>
        ) : org.pendingDomain && org.domainRecord ? (
          <div className="space-y-3 text-sm">
            <p><Trans k="team.domain.addRecord" vars={{ domain: org.pendingDomain }} parts={{ strong: text => <span className="font-medium">{text}</span> }} /></p>
            <CopyField value={org.domainRecord} label={t("team.domain.copyRecord")} />
            <div className="flex gap-2">
              <Button disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("team.domain.check")}</Button>
              <Button variant="ghost" onClick={() => removeDomain.mutate()}>{t("team.domain.another")}</Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); start.mutate({ domain }); }}>
            <Label htmlFor="team-domain" className="sr-only">{t("team.domain.label")}</Label>
            <Input id="team-domain" value={domain} onChange={event => setDomain(event.target.value)} placeholder="school.edu" className="sm:max-w-xs" />
            <Button type="submit" variant="outline" disabled={!domain.trim() || start.isPending}>{t("team.domain.verify")}</Button>
          </form>
        )}

        <div className="border-t border-border pt-5">
          <h3 className="text-sm font-medium">{t("team.sso.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {!mine.ssoConfigured
              ? t("team.sso.unavailable")
              : !org.sso.linked
                ? t("team.sso.emailUs", { team: org.name })
                : t("team.sso.linked")}
          </p>
          {mine.ssoConfigured && org.sso.linked && (
            <Button className="mt-3" variant="outline" disabled={portal.isPending} onClick={() => portal.mutate()}>{t("team.sso.open")}</Button>
          )}
          {org.role === "owner" && org.sso.canRequire && (
            <div className="mt-4 flex items-start gap-3">
              <Switch id="team-sso-only" checked={org.sso.required} disabled={ssoOnly.isPending} onCheckedChange={required => ssoOnly.mutate({ required })} className="mt-0.5" />
              <div>
                <Label htmlFor="team-sso-only" className="text-sm font-medium">{t("team.sso.require")}</Label>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t("team.sso.requireHint", { domain: org.verifiedDomain ?? "" })}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function DangerZone({ org, role }: { org: Org; role: OrgRole }) {
  useI18n();
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const onError = (error: { message: string }) => toast.error(error.message);
  const leave = trpc.teams.leave.useMutation({ onSuccess: async () => { setConfirm(null); toast.success(t("team.danger.left")); await utils.teams.mine.invalidate(); }, onError });
  const remove = trpc.teams.deleteTeam.useMutation({ onSuccess: async () => { setConfirm(null); toast.success(t("team.danger.deleted")); await utils.teams.mine.invalidate(); }, onError });
  return (
    <Card className="gap-0 p-6">
      <SectionHeading
        title={role === "owner" ? t("team.danger.deleteTitle") : t("team.danger.leaveTitle")}
        description={role === "owner" ? t("team.danger.deleteDescription") : t("team.danger.leaveDescription")}
      />
      <Button className="mt-4 self-start" variant="outline" onClick={() => setConfirm(role === "owner" ? "delete" : "leave")}>{role === "owner" ? t("team.danger.deleteButton") : t("team.danger.leaveButton")}</Button>
      <Dialog open={confirm !== null} onOpenChange={open => { if (!open) { setConfirm(null); setTyped(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? t("team.danger.confirmDelete", { name: org.name }) : t("team.danger.confirmLeave", { name: org.name })}</DialogTitle>
            <DialogDescription>{confirm === "delete" ? t("team.danger.confirmDeleteHint") : t("team.danger.confirmLeaveHint")}</DialogDescription>
          </DialogHeader>
          {confirm === "delete" && (
            <div className="space-y-2">
              <Label htmlFor="confirm-team-name">{t("team.teamName")}</Label>
              <Input id="confirm-team-name" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>{t("team.cancel")}</Button>
            {confirm === "delete" ? (
              <Button variant="destructive" disabled={typed.trim() !== org.name || remove.isPending} onClick={() => remove.mutate({ confirmName: typed })}>{t("team.danger.deleteButton")}</Button>
            ) : (
              <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutate()}>{t("team.danger.leaveButton")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** The team console (F3): library for everyone; members, usage and billing for admins and the owner. */
export default function Team() {
  useI18n();
  const mine = trpc.teams.mine.useQuery();
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") toast.success(t("team.checkoutThanks"));
  }, []);
  const org = mine.data?.org ?? null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />{t("common.library")}</Button>
          </Link>
          <h1 className="min-w-0 truncate text-lg font-semibold">{org ? org.name : t("team.title")}</h1>
          {org && <span className="ml-auto shrink-0 text-sm text-muted-foreground">{roleName(org.role)}</span>}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-4 py-10 focus:outline-none">
        {mine.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !mine.data?.available ? (
          <Card className="p-6"><p className="text-sm text-muted-foreground">{t("team.unavailable")}</p></Card>
        ) : !org ? (
          <>
            {mine.data.pendingInvites.length > 0 && (
              <Card className="gap-0 p-6">
                <h2 className="text-lg font-semibold">{t("team.invitesTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("team.invitesBody", { teams: mine.data.pendingInvites.map(item => item.orgName).join(", ") })}</p>
              </Card>
            )}
            <CreateTeam />
          </>
        ) : (
          <>
            <Library role={org.role} />
            <Members role={org.role} seats={mine.data.seats} />
            {orgCan(org.role, "view_usage") && <Usage />}
            {orgCan(org.role, "manage_billing") && <Billing org={org} mine={mine.data} />}
            {orgCan(org.role, "manage_domain") && <SignIn org={org} mine={mine.data} />}
            <DangerZone org={org} role={org.role} />
          </>
        )}
      </main>
    </div>
  );
}
