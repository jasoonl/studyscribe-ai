import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Plus,
  Loader2,
  XCircle,
  Trash2,
  Copy,
  Check,
  CalendarClock,
  ShieldAlert,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

type InviteCode = {
  id: number;
  code: string;
  email: string;
  isUsed: number;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  usedByEmail: string | null;
};

function getCodeStatus(code: InviteCode): "used" | "expired" | "active" | "expiring_soon" {
  if (code.isUsed) return "used";
  const now = new Date();
  const expires = new Date(code.expiresAt);
  if (expires < now) return "expired";
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (expires < sevenDays) return "expiring_soon";
  return "active";
}

function StatusBadge({ code }: { code: InviteCode }) {
  const status = getCodeStatus(code);
  if (status === "used") return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 gap-1"><CheckCircle2 className="w-3 h-3" />Used</Badge>;
  if (status === "expired") return <Badge variant="outline" className="text-red-500 border-red-300 bg-red-50 gap-1"><XCircle className="w-3 h-3" />Expired</Badge>;
  if (status === "expiring_soon") return <Badge variant="outline" className="text-orange-500 border-orange-300 bg-orange-50 gap-1"><AlertTriangle className="w-3 h-3" />Expiring Soon</Badge>;
  return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 gap-1"><CheckCircle2 className="w-3 h-3" />Active</Badge>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopy}>
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy code"}</TooltipContent>
    </Tooltip>
  );
}

export default function AdminInviteCodes() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();

  // Create code dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newExpiry, setNewExpiry] = useState(30);

  // Edit expiry dialog
  const [editTarget, setEditTarget] = useState<InviteCode | null>(null);
  const [editDate, setEditDate] = useState("");

  // Confirm revoke/delete dialog
  const [confirmTarget, setConfirmTarget] = useState<{ code: InviteCode; action: "revoke" | "delete" } | null>(null);

  const { data: codes, isLoading } = trpc.customAuth.listInviteCodes.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const createMutation = trpc.customAuth.createInviteCodeManual.useMutation({
    onSuccess: (data) => {
      toast.success(`Code created: ${data.code}`);
      navigator.clipboard.writeText(data.code);
      toast.info("Code copied to clipboard");
      setShowCreate(false);
      setNewEmail("");
      setNewExpiry(30);
      utils.customAuth.listInviteCodes.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateExpiryMutation = trpc.customAuth.updateInviteCodeExpiry.useMutation({
    onSuccess: () => {
      toast.success("Expiration date updated");
      setEditTarget(null);
      utils.customAuth.listInviteCodes.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeMutation = trpc.customAuth.revokeInviteCode.useMutation({
    onSuccess: () => {
      toast.success("Code revoked");
      setConfirmTarget(null);
      utils.customAuth.listInviteCodes.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.customAuth.deleteInviteCode.useMutation({
    onSuccess: () => {
      toast.success("Code deleted");
      setConfirmTarget(null);
      utils.customAuth.listInviteCodes.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>;

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-gray-500">
        <ShieldAlert className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium">Admin access required</p>
        <Link href="/dashboard"><Button variant="outline">Go to Dashboard</Button></Link>
      </div>
    );
  }

  const active = codes?.filter(c => getCodeStatus(c as InviteCode) === "active") ?? [];
  const expiringSoon = codes?.filter(c => getCodeStatus(c as InviteCode) === "expiring_soon") ?? [];
  const used = codes?.filter(c => getCodeStatus(c as InviteCode) === "used") ?? [];
  const expired = codes?.filter(c => getCodeStatus(c as InviteCode) === "expired") ?? [];

  const handleEditExpiry = (code: InviteCode) => {
    setEditTarget(code);
    // Pre-fill with current expiry date in YYYY-MM-DD format
    const d = new Date(code.expiresAt);
    setEditDate(d.toISOString().split("T")[0]);
  };

  const handleConfirmExpiry = () => {
    if (!editTarget || !editDate) return;
    updateExpiryMutation.mutate({ id: editTarget.id, expiresAt: new Date(editDate) });
  };

  const fmt = (d: Date | string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const CodeTable = ({ items, showActions = true }: { items: InviteCode[]; showActions?: boolean }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Intended For</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Used By</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Created</TableHead>
          {showActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? 7 : 6} className="text-center text-gray-400 py-8">
              No codes
            </TableCell>
          </TableRow>
        ) : items.map((code) => (
          <TableRow key={code.id} className={code.isUsed ? "opacity-60" : ""}>
            <TableCell>
              <div className="flex items-center gap-1">
                <code className="font-mono text-sm text-indigo-700 font-semibold">{code.code}</code>
                <CopyButton text={code.code} />
              </div>
            </TableCell>
            <TableCell className="text-sm text-gray-600">{code.email}</TableCell>
            <TableCell><StatusBadge code={code} /></TableCell>
            <TableCell className="text-sm text-gray-500">{code.usedByEmail ?? "—"}</TableCell>
            <TableCell className="text-sm text-gray-500">
              <span className={getCodeStatus(code) === "expiring_soon" ? "text-orange-500 font-medium" : ""}>
                {fmt(code.expiresAt)}
              </span>
            </TableCell>
            <TableCell className="text-sm text-gray-400">{fmt(code.createdAt)}</TableCell>
            {showActions && (
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {!code.isUsed && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditExpiry(code)}>
                            <CalendarClock className="w-3.5 h-3.5 text-gray-500" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit expiry</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmTarget({ code, action: "revoke" })}>
                            <XCircle className="w-3.5 h-3.5 text-orange-500" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Revoke code</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmTarget({ code, action: "delete" })}>
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete permanently</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/invite-requests">
            <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500">
              <ArrowLeft className="w-4 h-4" />
              Invite Requests
            </Button>
          </Link>
          <div className="h-5 w-px bg-gray-200" />
          <h1 className="text-lg font-semibold text-gray-900">Invite Code Management</h1>
        </div>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="w-4 h-4" />
          Create Code
        </Button>
      </div>

      {/* Stats bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex gap-6 text-sm">
        <span className="text-gray-500">Total: <strong className="text-gray-900">{codes?.length ?? 0}</strong></span>
        <span className="text-green-600">Active: <strong>{active.length}</strong></span>
        {expiringSoon.length > 0 && <span className="text-orange-500">Expiring Soon: <strong>{expiringSoon.length}</strong></span>}
        <span className="text-blue-600">Used: <strong>{used.length}</strong></span>
        <span className="text-red-500">Expired: <strong>{expired.length}</strong></span>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          </div>
        ) : (
          <>
            {/* Active + Expiring Soon */}
            {(active.length > 0 || expiringSoon.length > 0) && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Active Codes ({active.length + expiringSoon.length})
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <CodeTable items={[...expiringSoon, ...active] as InviteCode[]} />
                </div>
              </section>
            )}

            {/* Used */}
            {used.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Used Codes ({used.length})
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <CodeTable items={used as InviteCode[]} showActions={false} />
                </div>
              </section>
            )}

            {/* Expired */}
            {expired.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  Expired Codes ({expired.length})
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden opacity-70">
                  <CodeTable items={expired as InviteCode[]} />
                </div>
              </section>
            )}

            {codes?.length === 0 && (
              <div className="text-center py-20 text-gray-400">
                <Clock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-lg">No invite codes yet</p>
                <p className="text-sm mt-1">Create one to get started</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Code Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Invite Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Intended for (email)</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <p className="text-xs text-gray-400">The code will be tied to this email address.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-expiry">Expires in (days)</Label>
              <Input
                id="new-expiry"
                type="number"
                min={1}
                max={365}
                value={newExpiry}
                onChange={(e) => setNewExpiry(Number(e.target.value))}
              />
              <p className="text-xs text-gray-400">
                Expires: {new Date(Date.now() + newExpiry * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={!newEmail.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ email: newEmail.trim(), expiresInDays: newExpiry })}
            >
              {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create & Copy Code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Expiry Dialog */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Expiration Date</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              Code: <code className="font-mono text-indigo-700 font-semibold">{editTarget?.code}</code>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="edit-date">New expiration date</Label>
              <Input
                id="edit-date"
                type="date"
                value={editDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={!editDate || updateExpiryMutation.isPending}
              onClick={handleConfirmExpiry}
            >
              {updateExpiryMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke / Delete Confirm Dialog */}
      <Dialog open={!!confirmTarget} onOpenChange={() => setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={confirmTarget?.action === "delete" ? "text-red-600" : "text-orange-600"}>
              {confirmTarget?.action === "delete" ? "Delete Invite Code" : "Revoke Invite Code"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-gray-600">
              {confirmTarget?.action === "delete"
                ? `This will permanently delete the code `
                : `This will revoke the code `}
              <code className="font-mono text-indigo-700 font-semibold">{confirmTarget?.code.code}</code>
              {confirmTarget?.action === "delete"
                ? ". This cannot be undone."
                : ". It will no longer be usable for sign-up."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>Cancel</Button>
            <Button
              className={confirmTarget?.action === "delete" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-orange-500 hover:bg-orange-600 text-white"}
              disabled={revokeMutation.isPending || deleteMutation.isPending}
              onClick={() => {
                if (!confirmTarget) return;
                if (confirmTarget.action === "revoke") revokeMutation.mutate({ id: confirmTarget.code.id });
                else deleteMutation.mutate({ id: confirmTarget.code.id });
              }}
            >
              {(revokeMutation.isPending || deleteMutation.isPending)
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                : confirmTarget?.action === "delete" ? "Delete Permanently" : "Revoke Code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
