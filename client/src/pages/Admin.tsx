import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ShieldAlert, Users, KeyRound, Clock, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function Admin() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();

  const { data: users, isLoading: usersLoading } = trpc.customAuth.getAllUsers.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });
  const { data: requests } = trpc.customAuth.listInviteRequests.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const updateRoleMutation = trpc.customAuth.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      utils.customAuth.getAllUsers.invalidate();
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
        <ShieldAlert className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium">Admin access required</p>
        <Link href="/dashboard">
          <Button variant="outline">Go to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const pendingCount = requests?.filter((r) => r.status === "pending").length ?? 0;
  const adminCount = users?.filter((u) => u.role === "admin").length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-500" />
          <h1 className="text-lg font-semibold text-gray-900">Admin</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Stat cards / quick links */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Link href="/admin/invite-requests">
            <Card className="p-5 hover:border-indigo-300 transition-colors cursor-pointer">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Invite Requests</p>
                  <p className="text-2xl font-bold mt-1">{pendingCount}</p>
                  <p className="text-xs text-gray-400 mt-1">pending review</p>
                </div>
                <Clock className="w-6 h-6 text-indigo-400" />
              </div>
            </Card>
          </Link>
          <Link href="/admin/invite-codes">
            <Card className="p-5 hover:border-indigo-300 transition-colors cursor-pointer">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Invite Codes</p>
                  <p className="text-2xl font-bold mt-1">Manage</p>
                  <p className="text-xs text-gray-400 mt-1">issue &amp; revoke codes</p>
                </div>
                <KeyRound className="w-6 h-6 text-indigo-400" />
              </div>
            </Card>
          </Link>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Users</p>
                <p className="text-2xl font-bold mt-1">{users?.length ?? "—"}</p>
                <p className="text-xs text-gray-400 mt-1">{adminCount} admin{adminCount === 1 ? "" : "s"}</p>
              </div>
              <Users className="w-6 h-6 text-indigo-400" />
            </div>
          </Card>
        </div>

        {/* Users table */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Users
          </h2>
          <Card className="overflow-hidden">
            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Login</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last Signed In</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name || "—"}</TableCell>
                      <TableCell className="text-gray-500">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{u.loginMethod || "unknown"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          disabled={u.id === user.id || updateRoleMutation.isPending}
                          onValueChange={(role) =>
                            updateRoleMutation.mutate({ userId: u.id, role: role as "user" | "admin" })
                          }
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm">
                        {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "Never"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
