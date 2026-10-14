import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { forgetSessionUser } from "@/_core/hooks/sessionUser";
import { trpc } from "@/lib/trpc";

/** Settings card: signs out every session on every device, this one included (Phase 7). */
export function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const signOut = trpc.auth.signOutEverywhere.useMutation({
    onSuccess: () => {
      forgetSessionUser();
      window.location.href = "/login";
    },
    onError: (error) => toast.error(error.message || "Could not sign out of every device. Try again."),
  });

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Signed-in devices</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Lost a phone, or signed in on a shared computer? Sign out everywhere, including the StudyScribe app and this browser. Changing your password does the same.
      </p>
      <Button className="mt-4 w-fit" variant="outline" onClick={() => setOpen(true)}>Sign out of all devices</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of all devices?</DialogTitle>
            <DialogDescription>You will need to sign in again on every device, including this one. Your recordings are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>Sign out everywhere</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
