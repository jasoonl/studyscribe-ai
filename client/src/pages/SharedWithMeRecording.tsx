import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SharedRecordingView } from "@/components/SharedRecordingView";

export default function SharedWithMeRecording() {
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
        <p className="text-lg font-medium">{error?.message || "This recording isn't shared with you"}</p>
        <Link href="/shared-with-me">
          <Button variant="outline">Back to Shared with Me</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-14 flex items-center">
          <Link href="/shared-with-me">
            <Button variant="ghost" size="sm">&larr; Shared with Me</Button>
          </Link>
        </div>
      </div>
      <SharedRecordingView bundle={bundle} />
    </div>
  );
}
