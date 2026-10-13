import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

function WorkosLink({ team }: { team: { id: number; name: string; workosOrganizationId: string | null } }) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(team.workosOrganizationId ?? "");
  const link = trpc.teams.adminLinkWorkos.useMutation({
    onSuccess: async result => {
      toast.success(result.linked ? `${team.name} is linked to WorkOS` : `${team.name} is no longer linked`);
      await utils.teams.adminList.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  return (
    <form
      className="flex gap-2"
      onSubmit={event => {
        event.preventDefault();
        link.mutate({ orgId: team.id, workosOrganizationId: value.trim() || null });
      }}
    >
      <label htmlFor={`workos-${team.id}`} className="sr-only">WorkOS organisation id for {team.name}</label>
      <Input id={`workos-${team.id}`} value={value} onChange={event => setValue(event.target.value)} placeholder="org_01H..." className="h-8 w-44 font-mono text-xs" />
      <Button type="submit" size="sm" variant="outline" className="h-8" disabled={link.isPending || value.trim() === (team.workosOrganizationId ?? "")}>Save</Button>
    </form>
  );
}

/** Admin page (Phase 5 part 2): meeting note-taker, notes email, and teams with SAML linking. */
export function AdminPlatformSection() {
  const { data: bots } = trpc.diagnostics.meetingBots.useQuery(undefined, { refetchOnWindowFocus: false });
  const { data: attendee } = trpc.diagnostics.attendeeEmail.useQuery(undefined, { refetchOnWindowFocus: false });
  const { data: teams } = trpc.teams.adminList.useQuery(undefined, { refetchOnWindowFocus: false });

  return (
    <>
      {bots && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Meeting note-taker</h2>
          <Card className="gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={bots.configured ? "default" : "outline"}>{bots.configured ? "Recall.ai configured" : "Not configured"}</Badge>
              <Badge variant={bots.apiKey ? "default" : "destructive"}>API key {bots.apiKey ? "set" : "missing"}</Badge>
              <Badge variant={bots.region && bots.regionValid ? "default" : "destructive"}>Region {bots.region ?? "missing"}</Badge>
              <Badge variant={bots.webhookSecret ? "default" : "destructive"}>Webhook secret {bots.webhookSecret ? "set" : "missing"}</Badge>
              {bots.usingTestApi && <Badge variant="outline">Mock Recall API</Badge>}
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {bots.webhookUrl ? <>In Recall's dashboard, send bot status webhooks to <span className="font-mono">{bots.webhookUrl}</span>.</> : "Set PUBLIC_APP_URL to see the webhook address."}
            </p>
          </Card>
        </section>
      )}

      {attendee && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Emailing notes to attendees</h2>
          <Card className="gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={attendee.configured ? "default" : "outline"}>{attendee.configured ? "On" : "Off"}</Badge>
              <Badge variant={attendee.resend ? "default" : "destructive"}>Resend {attendee.resend ? "set" : "missing"}</Badge>
              <Badge variant={attendee.postalAddress ? "default" : "destructive"}>Postal address {attendee.postalAddress ? "set" : "missing"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">These emails are not transactional, so each carries an opt-out link and the postal address in EMAIL_POSTAL_ADDRESS.</p>
          </Card>
        </section>
      )}

      {teams?.available && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Teams</h2>
          <Card className="gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={teams.billingConfigured ? "default" : "outline"}>Team billing {teams.billingConfigured ? "on" : "off"}</Badge>
              <Badge variant={teams.workos.configured ? "default" : "outline"}>WorkOS SAML {teams.workos.configured ? "on" : "off"}</Badge>
            </div>
            {teams.workos.redirectUri && <p className="break-all text-xs text-muted-foreground">WorkOS redirect URI: <span className="font-mono">{teams.workos.redirectUri}</span></p>}
            {teams.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet.</p>
            ) : (
              <div className="relative min-w-0 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Team</th>
                      <th scope="col" className="px-3 py-2 font-medium">Members</th>
                      <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                      <th scope="col" className="px-3 py-2 font-medium">Domain</th>
                      {teams.workos.configured && <th scope="col" className="px-3 py-2 font-medium">WorkOS organisation</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {teams.teams.map(team => (
                      <tr key={team.id}>
                        <td className="px-3 py-2"><span className="block font-medium">{team.name}</span><span className="block text-xs text-muted-foreground">{team.ownerEmail}</span></td>
                        <td className="px-3 py-2 tabular-nums">{team.members}</td>
                        <td className="px-3 py-2">{team.status === "none" ? "Not started" : `${team.status}, ${team.seats} seats`}</td>
                        <td className="px-3 py-2">{team.verifiedDomain ?? "None"}</td>
                        {teams.workos.configured && <td className="px-3 py-2"><WorkosLink team={team} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      )}
    </>
  );
}
