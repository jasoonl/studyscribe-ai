import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SharedRecordingView } from "@/components/SharedRecordingView";
import { useI18n } from "@/i18n";

export default function SharedWithMeRecording() {
  const { t } = useI18n();
  const [, params] = useRoute("/shared-with-me/:id");
  const recordingId = params?.id ? parseInt(params.id) : 0;

  const { data: bundle, isLoading, error } = trpc.sharing.getSharedWithMe.useQuery(
    { recordingId },
    { enabled: !!recordingId, retry: false }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-center px-4">
        <ShieldAlert className="w-10 h-10 text-muted-foreground" />
        <p className="text-lg font-medium">{error?.message || t("shared.notShared")}</p>
        <Link href="/shared-with-me">
          <Button variant="outline">{t("shared.backTo")}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container h-14 flex items-center">
          <Link href="/shared-with-me">
            <Button variant="ghost" size="sm">&larr; {t("shared.title")}</Button>
          </Link>
        </div>
      </div>
      <SharedRecordingView bundle={bundle} role={bundle.role} />
    </div>
  );
}
