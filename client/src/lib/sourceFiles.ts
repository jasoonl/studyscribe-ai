import type { SourceSummary } from "./sourceModel";

/** Which files the Files page lists: everything, files with no course, or one course. */
export type FileScope = "all" | "unfiled" | number;

/** Reads the `course` address parameter: `unfiled`, a course id, or anything else meaning all. */
export function parseFileScope(value: string | null | undefined): FileScope {
  if (value === "unfiled") return "unfiled";
  if (value && /^\d+$/.test(value)) {
    const id = Number.parseInt(value, 10);
    if (id > 0) return id;
  }
  return "all";
}

/** The address parameter for a scope, or null for the default (all). */
export function fileScopeParam(scope: FileScope): string | null {
  return scope === "all" ? null : String(scope);
}

/** The course a new upload goes into: the open course, otherwise none. */
export function uploadCourseFor(scope: FileScope): number | null {
  return typeof scope === "number" ? scope : null;
}

export function matchesScope(source: Pick<SourceSummary, "courseId">, scope: FileScope): boolean {
  if (scope === "all") return true;
  if (scope === "unfiled") return source.courseId === null;
  return source.courseId === scope;
}

/** Case-insensitive match on the title and the original file name; an empty query matches all. */
export function matchesQuery(source: Pick<SourceSummary, "title" | "fileName">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return source.title.toLowerCase().includes(needle) || source.fileName.toLowerCase().includes(needle);
}

export function filterFiles<T extends Pick<SourceSummary, "courseId" | "title" | "fileName">>(sources: T[], scope: FileScope, query: string): T[] {
  return sources.filter(source => matchesScope(source, scope) && matchesQuery(source, query));
}

/** How many files each scope holds, for the filter labels. */
export function countByScope(sources: Array<Pick<SourceSummary, "courseId">>): { all: number; unfiled: number; byCourse: Map<number, number> } {
  const byCourse = new Map<number, number>();
  let unfiled = 0;
  for (const source of sources) {
    if (source.courseId === null) unfiled += 1;
    else byCourse.set(source.courseId, (byCourse.get(source.courseId) ?? 0) + 1);
  }
  return { all: sources.length, unfiled, byCourse };
}

/** A scope pointing at a course that is gone or archived falls back to all, so the page never lists nothing by mistake. */
export function resolveScope(scope: FileScope, activeCourseIds: number[]): FileScope {
  return typeof scope === "number" && !activeCourseIds.includes(scope) ? "all" : scope;
}

export function filesHref(scope: FileScope): string {
  return scope === "all" ? "/files" : `/files?course=${scope}`;
}
