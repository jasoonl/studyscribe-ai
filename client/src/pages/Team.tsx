import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
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
import { ORG_ROLE_LABELS, orgCan, type OrgRole } from "@shared/organizations";

const ago = (value: string | Date) => formatDistanceToNow(new Date(value), { addSuffix: true });

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
        aria-label={`Copy ${label}`}
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
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const create = trpc.teams.create.useMutation({
    onSuccess: async () => {
      toast.success("Team created");
      await utils.teams.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  return (
    <Card className="gap-0 p-6">
      <SectionHeading title="Start a team" description="For a class, a lab, a study group or a company. Members share courses in one library, and admins see usage across the team." />
      <form
        className="mt-5 flex flex-col gap-3 sm:flex-row"
        onSubmit={event => {
          event.preventDefault();
          create.mutate({ name: name.trim() });
        }}
      >
        <Label htmlFor="team-name" className="sr-only">Team name</Label>
        <Input id="team-name" value={name} onChange={event => setName(event.target.value)} placeholder="Biology 210 study team" maxLength={120} className="sm:max-w-sm" />
        <Button type="submit" disabled={name.trim().length < 2 || create.isPending}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create team"}
        </Button>
      </form>
    </Card>
  );
}

function Library({ role }: { role: OrgRole }) {
  const utils = trpc.useUtils();
  const library = trpc.teams.library.useQuery();
  const mine = trpc.teams.myCourses.useQuery();
  const [adding, setAdding] = useState<string>("");
  const refresh = () => Promise.all([utils.teams.library.invalidate(), utils.teams.myCourses.invalidate()]);
  const share = trpc.teams.shareCourse.useMutation({ onSuccess: async () => { setAdding(""); await refresh(); toast.success("Course added to the library"); }, onError: error => toast.error(error.message) });
  const unshare = trpc.teams.unshareCourse.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const addable = (mine.data ?? []).filter(course => !course.inLibrary);

  return (
    <Card className="gap-0 p-6">
      <SectionHeading title="Shared library" description="Courses members have shared with the team. Everyone in the team can open their recordings, transcripts and notes; only the owner of a course can change it." />
      <div className="mt-5 space-y-4">
        {library.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (library.data ?? []).length === 0 ? (
          <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Nothing shared yet. Add one of your courses below.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {library.data!.map(course => (
              <li key={course.courseId} className="flex items-center gap-3 px-4 py-3">
                <CourseDot color={course.color} />
                <Link href={`/team/courses/${course.courseId}`} className="min-w-0 flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="block truncate text-sm font-medium hover:underline">{course.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {course.recordings} {course.recordings === 1 ? "recording" : "recordings"} · {course.yours ? "Yours" : `Shared by ${course.sharedByName}`}
                  </span>
                </Link>
                {course.canRemove && (
                  <Button size="sm" variant="ghost" disabled={unshare.isPending} onClick={() => unshare.mutate({ courseId: course.courseId })}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Label htmlFor="team-add-course" className="sr-only">Course to share</Label>
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger id="team-add-course" className="sm:w-72"><SelectValue placeholder="Choose one of your courses" /></SelectTrigger>
              <SelectContent>
                {addable.map(course => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!adding || share.isPending} onClick={() => share.mutate({ courseId: Number(adding) })}>Add to library</Button>
          </div>
        )}
        {role === "member" && <p className="text-xs text-muted-foreground">Recordings in the library are read only for everyone but their owner.</p>}
      </div>
    </Card>
  );
}

function Members({ role, seats }: { role: OrgRole; seats: { limited: boolean; used: number; total: number | null; available: number | null } | null }) {
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
  const remove = trpc.teams.removeMember.useMutation({ onSuccess: async () => { toast.success("Removed from the team"); await refresh(); }, onError });
  const transfer = trpc.teams.transferOwnership.useMutation({ onSuccess: async () => { setTransferTo(null); toast.success("Ownership transferred"); await refresh(); }, onError });
  const showUsage = orgCan(role, "view_usage");

  return (
    <Card className="gap-0 p-6">
      <SectionHeading
        title="Members"
        description={seats?.limited ? `${seats.used} of ${seats.total} seats in use, counting pending invitations.` : "Seats are not limited on this server."}
      />
      <div className="relative mt-5 min-w-0 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Person</th>
              <th scope="col" className="px-4 py-2 font-medium">Role</th>
              {showUsage && <th scope="col" className="px-4 py-2 text-right font-medium">Minutes</th>}
              {showUsage && <th scope="col" className="px-4 py-2 text-right font-medium">AI uses</th>}
              {showUsage && <th scope="col" className="px-4 py-2 font-medium">Last active</th>}
              <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(members.data ?? []).map(member => {
              const canAct = !member.isYou && member.role !== "owner" && (role === "owner" || (role === "admin" && member.role === "member"));
              return (
                <tr key={member.userId}>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{member.name || member.email}{member.isYou && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
                    {member.name && <span className="block text-xs text-muted-foreground">{member.email}</span>}
                  </td>
                  <td className="px-4 py-3">{ORG_ROLE_LABELS[member.role]}</td>
                  {showUsage && <td className="px-4 py-3 text-right tabular-nums">{member.usage?.minutes ?? 0}</td>}
                  {showUsage && <td className="px-4 py-3 text-right tabular-nums">{member.usage?.generations ?? 0}</td>}
                  {showUsage && <td className="px-4 py-3 text-muted-foreground">{member.lastActive ? ago(member.lastActive) : "Never"}</td>}
                  <td className="px-2 py-3">
                    {canAct && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Options for ${member.name || member.email}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {role === "owner" && (
                            <DropdownMenuItem onSelect={() => setRole.mutate({ userId: member.userId, role: member.role === "admin" ? "member" : "admin" })}>
                              {member.role === "admin" ? "Make member" : "Make admin"}
                            </DropdownMenuItem>
                          )}
                          {role === "owner" && <DropdownMenuItem onSelect={() => setTransferTo({ userId: member.userId, name: member.name || member.email })}>Make owner</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => remove.mutate({ userId: member.userId })}>Remove from team</DropdownMenuItem>
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
            <Label htmlFor="invite-email" className="sr-only">Email address to invite</Label>
            <Input id="invite-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@school.edu" className="sm:flex-1" />
            <Label htmlFor="invite-role" className="sr-only">Role</Label>
            <Select value={inviteRole} onValueChange={value => setInviteRole(value as "member" | "admin")}>
              <SelectTrigger id="invite-role" className="sm:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!email.trim() || invite.isPending}>{invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}</Button>
          </form>
          {(invites.data ?? []).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Pending invitations</h3>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {invites.data!.map(item => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item.email} <span className="text-muted-foreground">· {ORG_ROLE_LABELS[item.role]} · expires {ago(item.expiresAt)}</span></span>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: item.id })}>Revoke</Button>
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
            <DialogTitle>Invitation ready</DialogTitle>
            <DialogDescription>{link?.emailed ? "We emailed it. You can also send this link yourself; it works only for the invited address and expires in 14 days." : "Send this link to them. It works only for the invited address and expires in 14 days, and it is shown only now."}</DialogDescription>
          </DialogHeader>
          {link && <CopyField value={link.url} label="invitation link" />}
          <DialogFooter><Button onClick={() => setLink(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferTo !== null} onOpenChange={open => !open && setTransferTo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make {transferTo?.name} the owner?</DialogTitle>
            <DialogDescription>They will manage billing, the domain, sign-in and deleting the team. You become an admin.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTo(null)}>Cancel</Button>
            <Button disabled={transfer.isPending} onClick={() => transferTo && transfer.mutate({ userId: transferTo.userId })}>Transfer ownership</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Usage() {
  const usage = trpc.teams.usage.useQuery();
  if (!usage.data) return null;
  const items = [
    { label: "Members", value: usage.data.members },
    { label: "Minutes transcribed", value: usage.data.minutes },
    { label: "AI generations", value: usage.data.generations },
    { label: "Recordings", value: usage.data.recordings },
  ];
  return (
    <Card className="gap-0 p-6">
      <SectionHeading title="This month" description={`Across the team, since the 1st (UTC). Each member's allowance on the ${usage.data.perMember.planName} plan is ${usage.data.perMember.minutes.toLocaleString("en-US")} minutes and ${usage.data.perMember.generations.toLocaleString("en-US")} AI generations.`} />
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {items.map(item => (
          <div key={item.label}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{item.value.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

type Mine = inferRouterOutputs<AppRouter>["teams"]["mine"];
type Org = NonNullable<Mine["org"]>;

function Billing({ org, mine }: { org: Org; mine: Mine }) {
  const utils = trpc.useUtils();
  const used = mine.seats?.used ?? 1;
  const [seats, setSeats] = useState(String(Math.max(used, org.subscription.seats || used)));
  useEffect(() => setSeats(String(Math.max(used, org.subscription.seats || used))), [used, org.subscription.seats]);
  const onError = (error: { message: string }) => toast.error(error.message);
  const checkout = trpc.teams.checkout.useMutation({ onSuccess: result => window.location.assign(result.url), onError });
  const portal = trpc.teams.portal.useMutation({ onSuccess: result => window.location.assign(result.url), onError });
  const setSeatCount = trpc.teams.setSeats.useMutation({ onSuccess: async result => { toast.success(`The team now has ${result.seats} seats.`); await utils.teams.mine.invalidate(); }, onError });
  const count = Number(seats);
  const valid = Number.isInteger(count) && count >= used && count <= 1000;

  return (
    <Card className="gap-0 p-6">
      <SectionHeading
        title="Team plan"
        description={`$${mine.plan.priceMonthlyUsd} per seat a month, plus any tax. Every member gets ${mine.plan.transcriptionMinutesPerMonth.toLocaleString("en-US")} minutes of transcription and ${mine.plan.aiGenerationsPerMonth.toLocaleString("en-US")} AI generations a month.`}
      />
      {!mine.billingConfigured ? (
        <p className="mt-5 rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">The team plan is not on sale on this server yet, so seats are not limited and nothing is charged.</p>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="text-sm">
            {org.subscription.active
              ? `Active with ${org.subscription.seats} ${org.subscription.seats === 1 ? "seat" : "seats"}${org.subscription.currentPeriodEnd ? `. ${org.subscription.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${new Date(org.subscription.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.`
              : org.subscription.status === "past_due"
                ? "The last payment did not go through. Update the card in billing to keep the plan."
                : "Not started. Until it is, only you have a seat."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="team-seats">Seats</Label>
              <Input id="team-seats" type="number" inputMode="numeric" min={used} max={1000} value={seats} onChange={event => setSeats(event.target.value)} className="w-28" />
            </div>
            {org.subscription.active ? (
              <Button variant="outline" disabled={!valid || count === org.subscription.seats || setSeatCount.isPending} onClick={() => setSeatCount.mutate({ seats: count })}>
                {setSeatCount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change seats"}
              </Button>
            ) : (
              <Button disabled={!valid || checkout.isPending} onClick={() => checkout.mutate({ seats: count })}>
                {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Start team plan, $${(mine.plan.priceMonthlyUsd * (valid ? count : 0)).toLocaleString("en-US")} a month`}
              </Button>
            )}
            {org.subscription.status !== "none" && (
              <Button variant="ghost" disabled={portal.isPending} onClick={() => portal.mutate()}>Invoices, card and cancelling</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Changing seats is prorated by Stripe. You cannot go below the {used} seats in use.</p>
        </div>
      )}
    </Card>
  );
}

function SignIn({ org, mine }: { org: Org; mine: Mine }) {
  const utils = trpc.useUtils();
  const [domain, setDomain] = useState("");
  const onError = (error: { message: string }) => toast.error(error.message);
  const refresh = () => utils.teams.mine.invalidate();
  const start = trpc.teams.startDomainVerification.useMutation({ onSuccess: refresh, onError });
  const check = trpc.teams.checkDomain.useMutation({ onSuccess: async result => { (result.verified ? toast.success : toast.info)(result.message); await refresh(); }, onError });
  const options = trpc.teams.setDomainOptions.useMutation({ onSuccess: refresh, onError });
  const removeDomain = trpc.teams.removeDomain.useMutation({ onSuccess: refresh, onError });
  const portal = trpc.teams.ssoPortal.useMutation({ onSuccess: result => window.open(result.url, "_blank", "noopener"), onError });

  return (
    <Card className="gap-0 p-6">
      <SectionHeading title="Domain and sign-in" description="Verify your school's or company's domain so Google Workspace accounts from it can join, and keep the team to that domain." />
      <div className="mt-5 space-y-5">
        {org.verifiedDomain ? (
          <>
            <p className="text-sm"><span className="font-medium">{org.verifiedDomain}</span> is verified.</p>
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="team-autojoin" className="text-sm font-medium">Let people from {org.verifiedDomain} join on their own</Label>
                <p className="mt-0.5 text-sm text-muted-foreground">When they continue with a Google Workspace account on this domain, they join as members if a seat is free.</p>
              </div>
              <Switch id="team-autojoin" checked={org.autoJoin} onCheckedChange={autoJoin => options.mutate({ autoJoin, restrictToDomain: org.restrictToDomain })} />
            </div>
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="team-restrict" className="text-sm font-medium">Only invite @{org.verifiedDomain} addresses</Label>
                <p className="mt-0.5 text-sm text-muted-foreground">People already in the team stay.</p>
              </div>
              <Switch id="team-restrict" checked={org.restrictToDomain} onCheckedChange={restrictToDomain => options.mutate({ autoJoin: org.autoJoin, restrictToDomain })} />
            </div>
            <Button variant="ghost" size="sm" className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => removeDomain.mutate()}>Remove the domain</Button>
          </>
        ) : org.pendingDomain && org.domainRecord ? (
          <div className="space-y-3 text-sm">
            <p>Add this TXT record at <span className="font-medium">{org.pendingDomain}</span> in your DNS settings, then check it. It can take up to an hour to appear.</p>
            <CopyField value={org.domainRecord} label="TXT record" />
            <div className="flex gap-2">
              <Button disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check the record"}</Button>
              <Button variant="ghost" onClick={() => removeDomain.mutate()}>Use another domain</Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); start.mutate({ domain }); }}>
            <Label htmlFor="team-domain" className="sr-only">Domain</Label>
            <Input id="team-domain" value={domain} onChange={event => setDomain(event.target.value)} placeholder="school.edu" className="sm:max-w-xs" />
            <Button type="submit" variant="outline" disabled={!domain.trim() || start.isPending}>Verify domain</Button>
          </form>
        )}

        <div className="border-t border-border pt-5">
          <h3 className="text-sm font-medium">SAML single sign-on</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {!mine.ssoConfigured
              ? "Not available on this server yet."
              : !org.sso.linked
                ? `Email us to turn on SAML for ${org.name}; we link your team to our sign-on provider, then your IT admin connects your identity provider.`
                : "Your IT admin connects Okta, Microsoft Entra ID or another identity provider in the setup portal. Members then use Sign in with SSO."}
          </p>
          {mine.ssoConfigured && org.sso.linked && (
            <Button className="mt-3" variant="outline" disabled={portal.isPending} onClick={() => portal.mutate()}>Open SSO setup</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function DangerZone({ org, role }: { org: Org; role: OrgRole }) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const onError = (error: { message: string }) => toast.error(error.message);
  const leave = trpc.teams.leave.useMutation({ onSuccess: async () => { setConfirm(null); toast.success("You left the team"); await utils.teams.mine.invalidate(); }, onError });
  const remove = trpc.teams.deleteTeam.useMutation({ onSuccess: async () => { setConfirm(null); toast.success("Team deleted"); await utils.teams.mine.invalidate(); }, onError });
  return (
    <Card className="gap-0 p-6">
      <SectionHeading
        title={role === "owner" ? "Delete the team" : "Leave the team"}
        description={role === "owner" ? "Cancels the team plan and removes the library and memberships. Everyone keeps their own recordings and courses." : "Your courses leave the shared library. Your recordings stay yours."}
      />
      <Button className="mt-4 self-start" variant="outline" onClick={() => setConfirm(role === "owner" ? "delete" : "leave")}>{role === "owner" ? "Delete team" : "Leave team"}</Button>
      <Dialog open={confirm !== null} onOpenChange={open => { if (!open) { setConfirm(null); setTyped(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? `Delete ${org.name}?` : `Leave ${org.name}?`}</DialogTitle>
            <DialogDescription>{confirm === "delete" ? "This cannot be undone. Type the team's name to confirm." : "You can be invited again later."}</DialogDescription>
          </DialogHeader>
          {confirm === "delete" && (
            <div className="space-y-2">
              <Label htmlFor="confirm-team-name">Team name</Label>
              <Input id="confirm-team-name" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm === "delete" ? (
              <Button variant="destructive" disabled={typed.trim() !== org.name || remove.isPending} onClick={() => remove.mutate({ confirmName: typed })}>Delete team</Button>
            ) : (
              <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutate()}>Leave team</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** The team console (F3): library for everyone; members, usage and billing for admins and the owner. */
export default function Team() {
  const mine = trpc.teams.mine.useQuery();
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") toast.success("Thanks. The team plan starts as soon as Stripe confirms the payment.");
  }, []);
  const org = mine.data?.org ?? null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />Dashboard</Button>
          </Link>
          <h1 className="min-w-0 truncate text-lg font-semibold">{org ? org.name : "Team"}</h1>
          {org && <span className="ml-auto shrink-0 text-sm text-muted-foreground">{ORG_ROLE_LABELS[org.role]}</span>}
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        {mine.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !mine.data?.available ? (
          <Card className="p-6"><p className="text-sm text-muted-foreground">Teams are not set up on this server yet.</p></Card>
        ) : !org ? (
          <>
            {mine.data.pendingInvites.length > 0 && (
              <Card className="gap-0 p-6">
                <h2 className="text-lg font-semibold">Invitations for you</h2>
                <p className="mt-1 text-sm text-muted-foreground">Open the link in the invitation email to join: {mine.data.pendingInvites.map(item => item.orgName).join(", ")}.</p>
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
