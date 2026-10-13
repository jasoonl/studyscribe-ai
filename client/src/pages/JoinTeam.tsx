import { useRoute } from "wouter";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import PublicLayout from "@/components/landing/PublicLayout";
import { Button } from "@/components/ui/button";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { trpc } from "@/lib/trpc";
import { ORG_ROLE_LABELS } from "@shared/organizations";

/**
 * /team/join/:token: accepting a team invitation (F3). Works signed out too:
 * it names the team and offers to sign in, or to create an account with the
 * sign-up invite that came with the team invitation, and comes back here.
 */
export default function JoinTeam() {
  const [, params] = useRoute("/team/join/:token");
  const token = params?.token ?? "";
  const { isAuthenticated, loading } = useCustomAuth();
  const preview = trpc.teams.invitePreview.useQuery({ token }, { enabled: token.length >= 16 && !loading, retry: false });
  const accept = trpc.teams.acceptInvite.useMutation({
    onSuccess: () => {
      toast.success("Welcome to the team");
      window.location.assign("/team");
    },
    onError: error => toast.error(error.message),
  });
  const next = encodeURIComponent(`/team/join/${token}`);
  const data = preview.data;

  return (
    <PublicLayout>
      <section className="mx-auto max-w-xl px-4 pb-24 pt-10 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {loading || preview.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !data ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">This invitation is not valid</h1>
              <p className="mt-3 text-muted-foreground">Ask the person who invited you for a new link.</p>
            </>
          ) : data.expired || data.accepted ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">{data.accepted ? "This invitation was already used" : "This invitation has expired"}</h1>
              <p className="mt-3 text-muted-foreground">Ask an admin of {data.orgName} for a new one.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Join {data.orgName}</h1>
              <p className="mt-3 text-muted-foreground">
                {data.inviterName ?? "A team admin"} invited {data.email} as {ORG_ROLE_LABELS[data.role].toLowerCase()}. Members share course recordings, transcripts and notes in one library.
              </p>
              {isAuthenticated ? (
                data.matchesYou ? (
                  <Button className="mt-6" disabled={accept.isPending} onClick={() => accept.mutate({ token })}>
                    {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join the team"}
                  </Button>
                ) : (
                  <p className="mt-6 rounded-xl bg-muted/50 px-4 py-3 text-sm">This invitation is for {data.email}. Sign out and sign in with that account to accept it.</p>
                )
              ) : (
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <Button asChild><a href={`/login?next=${next}`}>Sign in to accept</a></Button>
                  {data.signupCode && (
                    <Button variant="outline" asChild><a href={`/signup?code=${encodeURIComponent(data.signupCode)}&next=${next}`}>Create an account</a></Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
