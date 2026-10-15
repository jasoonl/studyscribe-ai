import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

/** A person's invite link and what it has earned (Phase 7 referrals). */
export default function InviteFriends() {
  const { t, formatNumber } = useI18n();
  const { data, isLoading } = trpc.referrals.mine.useQuery();
  const [copied, setCopied] = useState(false);
  const link = data?.code ? `${window.location.origin}/?ref=${data.code}` : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("invite.friends.copyFailed"));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("common.library")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-2xl pb-20 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("invite.friends.title")}</h1>
        {isLoading || !data ? (
          <div className="flex justify-center py-20" role="status" aria-label={t("common.loading")}>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <p className="mt-3 max-w-lg text-muted-foreground">
              {t("invite.friends.intro", { minutes: formatNumber(data.reward.transcriptionMinutes), generations: formatNumber(data.reward.aiGenerations) })}
            </p>

            {link ? (
              <Card className="mt-8 gap-0 p-6">
                <label htmlFor="invite-link" className="text-sm font-medium">{t("invite.friends.yourLink")}</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input id="invite-link" readOnly value={link} onFocus={event => event.currentTarget.select()} className="font-mono text-sm" />
                  <Button onClick={copy} className="shrink-0">{copied ? t("drafts.copied") : t("share.copyLink")}</Button>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("invite.friends.publicLinks")}
                </p>
              </Card>
            ) : (
              <Card className="mt-8 p-6">
                <p className="text-sm text-muted-foreground">{t("invite.friends.notSetUp")}</p>
              </Card>
            )}

            <dl className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
              <div className="bg-card p-4">
                <dt className="text-sm text-muted-foreground">{t("invite.friends.joined")}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.joined)}</dd>
              </div>
              <div className="bg-card p-4">
                <dt className="text-sm text-muted-foreground">{t("invite.friends.rewarded")}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.rewarded)}</dd>
              </div>
              <div className="bg-card p-4">
                <dt className="text-sm text-muted-foreground">{t("invite.friends.thisMonth")}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{t("invite.friends.extraMinutes", { minutes: formatNumber(data.rewardsThisMonth * data.reward.transcriptionMinutes) })}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("invite.friends.limit", { max: formatNumber(data.maxPerMonth) })}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
