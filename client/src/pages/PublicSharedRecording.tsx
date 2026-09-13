import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, Link2Off } from "lucide-react";
import { SharedRecordingView } from "@/components/SharedRecordingView";

export default function PublicSharedRecording() {
  const [, params] = useRoute("/shared/:token");
  const token = params?.token ?? "";

  const { data: bundle, isLoading, error } = trpc.sharing.getByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
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
        <Link2Off className="w-10 h-10 text-muted-foreground" />
        <p className="text-lg font-medium">This share link is invalid or has been turned off</p>
        <p className="text-sm text-muted-foreground">Ask the owner to share it with you again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SharedRecordingView bundle={bundle} />
    </div>
  );
}
