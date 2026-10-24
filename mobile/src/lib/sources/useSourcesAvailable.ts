import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";

export type SourceListItem = inferRouterOutputs<AppRouter>["sources"]["list"]["sources"][number];

/**
 * Whether study sources exist on this server (migration applied, no error). Everything about
 * sources stays hidden until this is true. Pass a course id for that course's sources only.
 */
export function useSourcesAvailable(courseId?: number): { available: boolean; loading: boolean; sources: SourceListItem[] } {
  const query = trpc.sources.list.useQuery(courseId === undefined ? undefined : { courseId }, { staleTime: 60_000, retry: false });
  if (query.isLoading) return { available: false, loading: true, sources: [] };
  if (query.error || !query.data || query.data.available !== true) return { available: false, loading: false, sources: [] };
  return { available: true, loading: false, sources: query.data.sources };
}
