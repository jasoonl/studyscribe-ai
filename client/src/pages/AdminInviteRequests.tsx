import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  XCircle,
  Clock,
  Users,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";

type Request = {
  id: number;
  name: string;
  email: string;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  createdAt: Date;
  reviewNote: string | null;
};

type ApproveResult = { success: boolean; code: string };

export default function AdminInviteRequests() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [reviewNote, setReviewNote] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [actionType, setActionType] = useState<"approve" | "deny" | null>(null);
  const [approvedCode, setApprovedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();

  const { data: requests, isLoading } = trpc.customAuth.listInviteRequests.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const approveMutation = trpc.customAuth.approveInviteRequest.useMutation({
    onSuccess: (data: ApproveResult) => {
      setApprovedCode(data.code);
      setActionType(null);
      setReviewNote("");
      utils.customAuth.listInviteRequests.invalidate();
      toast.success("Request approved! Invite code generated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const denyMutation = trpc.customAuth.denyInviteRequest.useMutation({
    onSuccess: () => {
      setSelectedRequest(null);
      setActionType(null);
      setReviewNote("");
      utils.customAuth.listInviteRequests.invalidate();
      toast.success("Request denied.");
    },
    onError: (err) => toast.error(err.message),
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-gray-500">
        <XCircle className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium">Admin access required</p>
        <Link href="/dashboard">
          <Button variant="outline">Go to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const pending = requests?.filter((r) => r.status === "pending") ?? [];
  const reviewed = requests?.filter((r) => r.status !== "pending") ?? [];

  const handleAction = (req: Request, type: "approve" | "deny") => {
    setSelectedRequest(req);
    setActionType(type);
    setReviewNote("");
    setApprovedCode(null);
  };

  const handleConfirm = () => {
    if (!selectedRequest) return;
    if (actionType === "approve") {
      approveMutation.mutate({ requestId: selectedRequest.id, reviewNote: reviewNote || undefined });
    } else {
      denyMutation.mutate({ requestId: selectedRequest.id, reviewNote: reviewNote || undefined });
    }
  };

  const copyCode = () => {
    if (!approvedCode) return;
    navigator.clipboard.writeText(approvedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusBadge = (status: string) => {
    if (status === "pending") return <Badge variant="outline" className="text-yellow-600 border-yellow-300 bg-yellow-50"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    if (status === "approved") return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
    return <Badge variant="outline" className="text-red-500 border-red-300 bg-red-50"><XCircle className="w-3 h-3 mr-1" />Denied</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          <h1 className="text-lg font-semibold text-gray-900">Invite Requests</h1>
          {pending.length > 0 && (
            <Badge className="bg-indigo-600 text-white text-xs">{pending.length} pending</Badge>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Pending Requests */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Pending ({pending.length})
          </h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : pending.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p>No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((req) => (
                <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-gray-900">{req.name}</span>
                      {statusBadge(req.status)}
                    </div>
                    <p className="text-sm text-gray-500">{req.email}</p>
                    {req.reason && (
                      <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 italic">
                        "{req.reason}"
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-2">
                      Requested {new Date(req.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                      onClick={() => handleAction(req as Request, "approve")}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-500 border-red-200 hover:bg-red-50 gap-1.5"
                      onClick={() => handleAction(req as Request, "deny")}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Reviewed Requests */}
        {reviewed.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Reviewed ({reviewed.length})
            </h2>
            <div className="space-y-2">
              {reviewed.map((req) => (
                <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 opacity-75">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-700 text-sm">{req.name}</span>
                      <span className="text-gray-400 text-xs">{req.email}</span>
                      {statusBadge(req.status)}
                    </div>
                    {req.reviewNote && (
                      <p className="text-xs text-gray-400 mt-1">Note: {req.reviewNote}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Approve/Deny Dialog */}
      <Dialog open={!!selectedRequest && !!actionType && !approvedCode} onOpenChange={() => { setSelectedRequest(null); setActionType(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Request" : "Deny Request"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-600">
              {actionType === "approve"
                ? `Approving will generate a unique invite code for ${selectedRequest?.name} (${selectedRequest?.email}). You'll receive the code via notification to forward to them.`
                : `Are you sure you want to deny ${selectedRequest?.name}'s request?`}
            </p>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <Textarea
                placeholder={actionType === "approve" ? "Welcome note for your records..." : "Reason for denial..."}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedRequest(null); setActionType(null); }}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={approveMutation.isPending || denyMutation.isPending}
              className={actionType === "approve" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
            >
              {(approveMutation.isPending || denyMutation.isPending) ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
              ) : actionType === "approve" ? "Approve & Generate Code" : "Deny Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approved Code Dialog */}
      <Dialog open={!!approvedCode} onOpenChange={() => { setApprovedCode(null); setSelectedRequest(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              Invite Code Generated
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <p className="text-sm text-gray-600">
              Share this invite code with <strong>{selectedRequest?.name}</strong> ({selectedRequest?.email}). It expires in 30 days.
            </p>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <code className="flex-1 text-indigo-700 font-mono font-semibold text-lg tracking-wider">
                {approvedCode}
              </code>
              <Button size="sm" variant="ghost" onClick={copyCode} className="shrink-0">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              You also received a notification with this code. Forward it to the user via email.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => { setApprovedCode(null); setSelectedRequest(null); }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
