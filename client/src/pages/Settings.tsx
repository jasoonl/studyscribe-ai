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
import { UsageMeters } from "@/components/UsageMeters";

export default function Settings() {
  const { user } = useAuth();
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
      toast.success("Your data was downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  };

  const handleDelete = async () => {
    try {
      const result = await deleteMutation.mutateAsync({ confirmEmail, password: password || undefined });
      toast.success(
        result.providerCopiesNotRemoved > 0
          ? "Your account was deleted. Some copies at our transcription provider could not be removed automatically; contact us to finish."
          : "Your account and all of its data were deleted",
      );
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the account");
    }
  };

  const matches = !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />Dashboard</Button>
          </Link>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Account</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{user?.name || "Not set"}</dd></div>
            <div><dt className="text-muted-foreground">Email</dt><dd className="font-medium">{user?.email}</dd></div>
          </dl>
        </Card>

        <Card className="gap-0 p-6" id="plan">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">Plan and usage</h2>
            <Link href="/billing" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Billing</Link>
          </div>
          {billing.data ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">You are on the {billing.data.plan.name} plan.</p>
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
              <Label htmlFor="auto-notes" className="text-lg font-semibold">Write notes automatically</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                When you open a recording whose transcript is ready and has no notes yet, StudyScribe writes them with the Lecture or Meeting template. Saved in this browser.
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

        <VocabularySettings />

        <ConnectedAppsSettings />

        <WebhookSettings />

        <ApiKeySettings />

        <Card className="p-6">
          <h2 className="text-lg font-semibold">Download your data</h2>
          <p className="mt-2 text-sm text-muted-foreground">Get a file with your account details, recordings, transcripts and every study material we hold about you. Audio files are not included; download those from each recording.</p>
          <Button className="mt-4 gap-2" variant="outline" onClick={handleExport} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export my data
          </Button>
        </Card>

        <Card className="border-destructive/40 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive"><ShieldAlert className="h-5 w-5" />Delete your account</h2>
          <p className="mt-2 text-sm text-muted-foreground">This permanently deletes your account, recordings and audio, transcripts, flashcards, quizzes, study guides, chats, shared links, comments, study groups you run, webhooks and connected apps. It cannot be undone, so export anything you want to keep first.</p>
          <Button className="mt-4" variant="destructive" onClick={() => setConfirmOpen(true)}>Delete my account</Button>
        </Card>

        <p className="text-sm text-muted-foreground">
          Read our <Link href="/terms" className="text-primary hover:underline">Terms</Link> and <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </main>

      <Dialog open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) { setConfirmEmail(""); setPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account permanently?</DialogTitle>
            <DialogDescription>Everything is removed immediately and cannot be recovered. Type your email address to confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-email">Your email ({user?.email})</Label>
              <Input id="confirm-email" autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Password</Label>
              <Input id="confirm-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave empty if you only sign in with Google.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleteMutation.isPending}>Keep my account</Button>
            <Button variant="destructive" disabled={!matches || deleteMutation.isPending} onClick={handleDelete}>
              {deleteMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting</> : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
