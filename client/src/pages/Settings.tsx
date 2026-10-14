import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAutoNotesEnabled, setAutoNotesEnabled } from "@/lib/preferences";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { VocabularySettings } from "@/components/VocabularySettings";
import { ConnectedAppsSettings } from "@/components/ConnectedAppsSettings";
import { WebhookSettings } from "@/components/WebhookSettings";
import { ApiKeySettings } from "@/components/ApiKeySettings";
import { TeamSettingsCard } from "@/components/TeamSettingsCard";
import { UsageMeters } from "@/components/UsageMeters";
import { SignOutEverywhere } from "@/components/SignOutEverywhere";
import { LanguagePicker } from "@/components/LanguagePicker";
import { Trans, useI18n } from "@/i18n";

export default function Settings() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [autoNotes, setAutoNotes] = useState(getAutoNotesEnabled);

  const billing = trpc.billing.status.useQuery();
  const exportMutation = trpc.account.exportData.useMutation();
  const deleteMutation = trpc.account.deleteAccount.useMutation();

  const handleExport = async () => {
    try {
      const data = await exportMutation.mutateAsync();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `studyscribe-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("settings.exported"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.exportFailed"));
    }
  };

  const handleDelete = async () => {
    try {
      const result = await deleteMutation.mutateAsync({ confirmEmail, password: password || undefined });
      toast.success(
        result.providerCopiesNotRemoved > 0
          ? t("settings.deletedPartly")
          : t("settings.deletedAll"),
      );
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.deleteFailed"));
    }
  };

  const matches = !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />{t("common.library")}</Button>
          </Link>
          <h1 className="text-lg font-semibold">{t("common.settings")}</h1>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl space-y-6 px-4 py-10 focus:outline-none">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">{t("settings.account")}</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("settings.name")}</dt><dd className="font-medium">{user?.name || t("settings.notSet")}</dd></div>
            <div><dt className="text-muted-foreground">{t("settings.email")}</dt><dd className="font-medium">{user?.email}</dd></div>
          </dl>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div>
              <h2 className="text-lg font-semibold">{t("language.label")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("language.settingsHelp")}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t("language.reviewNote")}</p>
            </div>
            <LanguagePicker id="settings-language" className="shrink-0" />
          </div>
        </Card>

        <Card className="gap-0 p-6" id="plan">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">{t("settings.planUsage")}</h2>
            <Link href="/billing" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{t("settings.billing")}</Link>
          </div>
          {billing.data ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">{t("settings.onPlan", { plan: billing.data.plan.name })}</p>
              <div className="mt-5">
                <UsageMeters usage={billing.data.usage} isAdmin={user?.role === "admin"} />
              </div>
            </>
          ) : (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <Label htmlFor="auto-notes" className="text-lg font-semibold">{t("settings.autoNotes")}</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.autoNotesHelp")}
              </p>
            </div>
            <Switch
              id="auto-notes"
              checked={autoNotes}
              onCheckedChange={checked => {
                setAutoNotes(checked);
                setAutoNotesEnabled(checked);
              }}
            />
          </div>
        </Card>

        <TeamSettingsCard />

        <VocabularySettings />

        <ConnectedAppsSettings />

        <WebhookSettings />

        <ApiKeySettings />

        <SignOutEverywhere />

        <Card className="p-6">
          <h2 className="text-lg font-semibold">{t("settings.download")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("settings.downloadHelp")}</p>
          <Button className="mt-4 gap-2" variant="outline" onClick={handleExport} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("settings.export")}
          </Button>
        </Card>

        <Card className="border-destructive/40 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive"><ShieldAlert className="h-5 w-5" />{t("settings.delete")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("settings.deleteHelp")}</p>
          <Button className="mt-4" variant="destructive" onClick={() => setConfirmOpen(true)}>{t("settings.deleteButton")}</Button>
        </Card>

        <p className="text-sm text-muted-foreground">
          <Trans
            k="settings.legal"
            parts={{
              terms: text => <Link href="/terms" className="text-primary underline underline-offset-2">{text}</Link>,
              privacy: text => <Link href="/privacy" className="text-primary underline underline-offset-2">{text}</Link>,
            }}
          />
        </p>
      </main>

      <Dialog open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) { setConfirmEmail(""); setPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings.confirmText")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-email">{t("settings.yourEmail", { email: user?.email ?? "" })}</Label>
              <Input id="confirm-email" autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("common.password")}</Label>
              <Input id="confirm-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("settings.googleOnly")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleteMutation.isPending}>{t("settings.keep")}</Button>
            <Button variant="destructive" disabled={!matches || deleteMutation.isPending} onClick={handleDelete}>
              {deleteMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("settings.deleting")}</> : t("settings.deleteEverything")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
