import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export function GroupFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { groupId: number; name: string; description: string | null };
  onSaved?: (groupId: number) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const utils = trpc.useUtils();
  const create = trpc.groups.create.useMutation();
  const update = trpc.groups.update.useMutation();
  const pending = create.isPending || update.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      let id = initial?.groupId;
      if (initial) await update.mutateAsync({ groupId: initial.groupId, name, description });
      else id = (await create.mutateAsync({ name, description })).id;
      await Promise.all([utils.groups.list.invalidate(), id ? utils.groups.get.invalidate({ groupId: id }) : undefined]);
      onOpenChange(false);
      if (id) onSaved?.(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the group");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (next) {
          setName(initial?.name ?? "");
          setDescription(initial?.description ?? "");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{initial ? "Edit group" : "New study group"}</DialogTitle>
            <DialogDescription>A group is a shared space for a class or a revision circle. Members see what is shared to it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="BIO 101 revision" autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-description">About (optional)</Label>
            <Textarea id="group-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} placeholder="Who it is for and what you share here" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : initial ? "Save" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Study groups (D2): the groups you are in. */
export default function Groups() {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = trpc.groups.list.useQuery();
  const groups = data?.groups ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Library
            </Button>
          </Link>
          {data?.available !== false && (
            <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New group
            </Button>
          )}
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Study groups</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Share lectures or whole courses with classmates, then talk them through in comments on the transcript.
        </p>

        <div className="mt-8">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-7 w-7 animate-spin text-accent" />
            </div>
          ) : data && !data.available ? (
            <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">Study groups are not available on this server yet.</p>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
              <p className="mx-auto max-w-md text-muted-foreground">
                No groups yet. Start one for a class, invite classmates by email or with a link, and share recordings to it.
              </p>
              <Button variant="outline" className="mt-5 gap-2" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New group
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
              {groups.map(group => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{group.name}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                        <span>
                          {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                        </span>
                        <span>
                          {group.itemCount} shared item{group.itemCount === 1 ? "" : "s"}
                        </span>
                        {group.lastSharedAt && <span>last share {formatDistanceToNow(new Date(group.lastSharedAt), { addSuffix: true })}</span>}
                      </p>
                    </div>
                    {group.role === "owner" && <span className="shrink-0 text-xs font-medium text-muted-foreground">Owner</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <GroupFormDialog open={creating} onOpenChange={setCreating} onSaved={id => navigate(`/groups/${id}`)} />
    </div>
  );
}
