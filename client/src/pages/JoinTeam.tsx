import { useRoute } from "wouter";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import PublicLayout from "@/components/landing/PublicLayout";
import { Button } from "@/components/ui/button";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

/**
 * /team/join/:token: accepting a team invitation (F3). Works signed out too:
 * it names the team and offers to sign in, or to create an account with the
 * sign-up invite that came with the team invitation, and comes back here.
 */
export default function JoinTeam() {
  const [, params] = useRoute("/team/join/:token");
  const token = params?.token ?? "";
  const { t } = useI18n();
  const { isAuthenticated, loading } = useCustomAuth();
  const preview = trpc.teams.invitePreview.useQuery({ token }, { enabled: token.length >= 16 && !loading, retry: false });
  const accept = trpc.teams.acceptInvite.useMutation({
    onSuccess: () => {
      toast.success(t("team.join.welcome"));
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
              <h1 className="text-2xl font-bold tracking-tight">{t("team.join.invalidTitle")}</h1>
              <p className="mt-3 text-muted-foreground">{t("team.join.invalidHint")}</p>
            </>
          ) : data.expired || data.accepted ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">{data.accepted ? t("team.join.usedTitle") : t("team.join.expiredTitle")}</h1>
              <p className="mt-3 text-muted-foreground">{t("team.join.askAdmin", { team: data.orgName })}</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">{t("team.join.title", { team: data.orgName })}</h1>
              <p className="mt-3 text-muted-foreground">
                {t(`team.join.invited.${data.role}`, { inviter: data.inviterName ?? t("team.join.aTeamAdmin"), email: data.email })}
              </p>
              {isAuthenticated ? (
                data.matchesYou ? (
                  <Button className="mt-6" disabled={accept.isPending} onClick={() => accept.mutate({ token })}>
                    {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("team.join.join")}
                  </Button>
                ) : (
                  <p className="mt-6 rounded-xl bg-muted/50 px-4 py-3 text-sm">{t("team.join.wrongAccount", { email: data.email })}</p>
                )
              ) : (
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <Button asChild><a href={`/login?next=${next}`}>{t("team.join.signIn")}</a></Button>
                  {data.signupCode && (
                    <Button variant="outline" asChild><a href={`/signup?code=${encodeURIComponent(data.signupCode)}&next=${next}`}>{t("team.join.createAccount")}</a></Button>
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
