import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { forgetSessionUser } from "@/_core/hooks/sessionUser";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";

/** Settings card: signs out every session on every device, this one included (Phase 7). */
export function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const signOut = trpc.auth.signOutEverywhere.useMutation({
    onSuccess: () => {
      forgetSessionUser();
      window.location.href = "/login";
    },
    onError: (error) => toast.error(error.message || t("devices.failed")),
  });

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{t("devices.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("devices.help")}
      </p>
      <Button className="mt-4 w-fit" variant="outline" onClick={() => setOpen(true)}>{t("devices.button")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("devices.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("devices.confirmText")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("devices.cancel")}</Button>
            <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>{t("devices.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
