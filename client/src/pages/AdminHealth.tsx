import { Link } from "wouter";
import { ArrowLeft, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const STATUS_LABEL = { ok: "Working", warn: "Needs attention", error: "Not working", off: "Off" } as const;
const STATUS_DOT = { ok: "bg-emerald-600", warn: "bg-amber-500", error: "bg-destructive", off: "bg-muted-foreground/50" } as const;

/**
 * Admin System health (Phase 6): one live check per service the app depends
 * on, each with a status in words (never colour alone) and a plain sentence.
 * The server never returns keys or raw provider errors.
 */
export default function AdminHealth() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";
  const health = trpc.diagnostics.health.useQuery(undefined, { enabled: isAdmin, retry: false, refetchOnWindowFocus: false });
  const checks = health.data?.checks ?? [];
  const problems = checks.filter(check => check.status === "error" || check.status === "warn").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Admin
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="container max-w-3xl pb-20 pt-10 focus:outline-none">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-[-0.04em]">System health</h1>
            <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
              {health.isFetching
                ? "Checking each service…"
                : health.data
                  ? problems === 0
                    ? `Everything configured is working. Checked ${new Date(health.data.checkedAt).toLocaleTimeString()}.`
                    : `${problems} service${problems === 1 ? " needs" : "s need"} attention. Checked ${new Date(health.data.checkedAt).toLocaleTimeString()}.`
                  : " "}
            </p>
          </div>
          {isAdmin && (
            <Button variant="outline" className="gap-2" disabled={health.isFetching} onClick={() => void health.refetch()}>
              <RotateCw className={cn("h-4 w-4", health.isFetching && "motion-safe:animate-spin")} aria-hidden="true" />
              Check again
            </Button>
          )}
        </div>

        {loading || (isAdmin && health.isLoading) ? (
          <div className="flex justify-center py-16" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Checking services</span>
          </div>
        ) : !isAdmin ? (
          <p className="text-muted-foreground">Only admins can see this page.</p>
        ) : health.error ? (
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="font-medium">The health check itself failed: {health.error.message}</p>
            <Button className="mt-4" variant="outline" onClick={() => void health.refetch()}>Try again</Button>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {checks.map(check => (
              <li key={check.id} className="flex flex-col gap-1 p-5 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", STATUS_DOT[check.status])} aria-hidden="true" />
                  <div className="min-w-0">
                    <h2 className="font-semibold">{check.label}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                </div>
                <p className="shrink-0 pl-5 text-sm sm:pl-0 sm:text-right">
                  <span className="font-medium">{STATUS_LABEL[check.status]}</span>
                  {check.latencyMs !== null && <span className="block text-xs tabular-nums text-muted-foreground">{check.latencyMs} ms</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
