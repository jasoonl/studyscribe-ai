import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link2, Copy, Check, Loader2, X, Users } from "lucide-react";
import { toast } from "sonner";

export function ShareRecordingDialog({
  recordingId,
  open,
  onOpenChange,
}: {
  recordingId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const utils = trpc.useUtils();

  const { data: shareState, isLoading } = trpc.sharing.getShareState.useQuery(
    { recordingId },
    { enabled: open }
  );

  const invalidate = () => utils.sharing.getShareState.invalidate({ recordingId });

  const enableLink = trpc.sharing.enablePublicLink.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });
  const disableLink = trpc.sharing.disablePublicLink.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });
  const shareWithUser = trpc.sharing.shareWithUser.useMutation({
    onSuccess: (data) => {
      toast.success(`Shared with ${data.sharedWithEmail}`);
      setEmail("");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const unshareWithUser = trpc.sharing.unshareWithUser.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const shareUrl = shareState?.publicShareToken
    ? `${window.location.origin}/shared/${shareState.publicShareToken}`
    : null;

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWithUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    shareWithUser.mutate({ recordingId, email: email.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Recording</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {/* Public link */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Link2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Anyone with the link</span>
              </div>
              {shareUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs truncate">{shareUrl}</code>
                    <Button size="sm" variant="ghost" onClick={copyLink} className="shrink-0 h-7 w-7 p-0">
                      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-500 border-red-200 hover:bg-red-50"
                    disabled={disableLink.isPending}
                    onClick={() => disableLink.mutate({ recordingId })}
                  >
                    Turn off link
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enableLink.isPending}
                  onClick={() => enableLink.mutate({ recordingId })}
                >
                  {enableLink.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                  Create shareable link
                </Button>
              )}
              <p className="text-xs text-muted-foreground mt-1.5">
                Anyone with this link can view the transcript, notes, flashcards, quizzes, and study guides &mdash; no account needed.
              </p>
            </div>

            {/* Share with specific accounts */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Share with a StudyScribe account</span>
              </div>
              <form onSubmit={handleShareWithUser} className="flex gap-2">
                <Input
                  type="email"
                  placeholder="friend@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" size="sm" disabled={shareWithUser.isPending || !email.trim()}>
                  {shareWithUser.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Share"}
                </Button>
              </form>

              {shareState && shareState.shares.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {shareState.shares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between bg-muted rounded-lg px-3 py-1.5 text-sm"
                    >
                      <span className="truncate">{share.sharedWithEmail}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 shrink-0"
                        disabled={unshareWithUser.isPending}
                        onClick={() =>
                          unshareWithUser.mutate({ recordingId, sharedWithUserId: share.sharedWithUserId })
                        }
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1.5">
                They must already have a StudyScribe account. It'll appear in their "Shared with Me" list.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
