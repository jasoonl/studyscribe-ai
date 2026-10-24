import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n";

/** Deleting removes the file and everything read from it, so it asks first. */
export function DeleteSourceDialog({ title, open, onOpenChange, onConfirm, pending }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; pending?: boolean }) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("sources.delete.title", { name: title })}</AlertDialogTitle>
          <AlertDialogDescription>{t("sources.delete.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("sources.delete.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={event => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-white hover:brightness-110"
          >
            {t("sources.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
