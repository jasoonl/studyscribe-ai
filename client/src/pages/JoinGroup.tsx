import { Link, useLocation, useRoute } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/** Landing page for a study group's join link (D2). */
export default function JoinGroup() {
  const [, params] = useRoute("/groups/join/:token");
  const [, navigate] = useLocation();
  const token = params?.token ?? "";
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.groups.previewJoin.useQuery({ token }, { enabled: token.length >= 10, retry: false });
  const join = trpc.groups.join.useMutation({
    onSuccess: async result => {
      await utils.groups.list.invalidate();
      navigate(`/groups/${result.groupId}`);
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <main id="main-content" className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm" tabIndex={-1}>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
          </div>
        ) : error || !data ? (
          <div className="text-center">
            <ShieldAlert className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 font-medium">{error?.message || "This join link is not valid."}</p>
            <Link href="/groups">
              <Button variant="outline" className="mt-5">
                Your groups
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">You have been invited to a study group</p>
            <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em]">{data.name}</h1>
            {data.description && <p className="mt-2 text-muted-foreground">{data.description}</p>}
            <p className="mt-3 text-sm text-muted-foreground">
              {data.memberCount} member{data.memberCount === 1 ? "" : "s"}. Members see the recordings and courses shared to the group, and can comment if the person sharing allows it.
            </p>
            <div className="mt-6 flex gap-2">
              {data.isMember ? (
                <Button onClick={() => navigate(`/groups/${data.groupId}`)}>Open the group</Button>
              ) : (
                <Button onClick={() => join.mutate({ token })} disabled={join.isPending}>
                  {join.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join group"}
                </Button>
              )}
              <Link href="/dashboard">
                <Button variant="ghost">Not now</Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
