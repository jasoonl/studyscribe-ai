import { TRPCClientError } from "@trpc/client";
import { unitFromPageParam } from "@/lib/sources/location";
import type { SourceKind } from "@/lib/sources/model";
import { USAGE_LIMIT_SENTENCE } from "@/lib/trpc";

/** Pure helpers for the source detail screen and the Ask source pieces. */

export type DetailTab = "summary" | "points" | "pages";
export const DETAIL_TABS: readonly DetailTab[] = ["summary", "points", "pages"];

export type DetailParams = { tab: DetailTab; unit: number | null; quote: string | null };

const first = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/**
 * Reads the route params of /sources/:id. A `page` opens the Pages tab, whatever `tab` says;
 * `q` only counts together with a valid page and is capped at 120 characters.
 */
export function parseDetailParams(raw: { tab?: string | string[]; page?: string | string[]; q?: string | string[] }, unitCount: number): DetailParams {
  const tabValue = first(raw.tab);
  const unit = unitFromPageParam(first(raw.page), unitCount);
  const quote = first(raw.q)?.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const tab: DetailTab = unit !== null ? "pages" : (DETAIL_TABS as readonly string[]).includes(tabValue ?? "") ? (tabValue as DetailTab) : "summary";
  return { tab, unit, quote: unit !== null ? quote : null };
}

/** One key per source, page and quote: focus and scrolling happen once for a key, never on a re-render. */
export function revealKey(sourceId: number, unitIndex: number, quote: string | null): string {
  return `${sourceId}:${unitIndex}:${quote ?? ""}`;
}

/** The label for the third tab. */
export function pagesTabLabel(kind: SourceKind): string {
  return kind === "pptx" ? "Slides" : kind === "pdf" ? "Pages" : "Sections";
}

/** "3 slides", "1 page", "2 sections". */
export function unitCountText(kind: SourceKind, count: number): string {
  const noun = kind === "pptx" ? "slide" : kind === "pdf" ? "page" : "section";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Index of the rendered line that holds character `offset`, from the lines `onTextLayout` reports,
 * or null when the lines do not add up to the text (platforms differ on whether a line's text keeps
 * its newline), in which case the caller scrolls to the top of the article instead of a wrong line.
 */
export function lineIndexAt(lines: readonly { text: string }[], offset: number, textLength?: number): number | null {
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, line) => sum + line.text.length, 0);
  if (textLength !== undefined && total !== textLength) return null;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    seen += lines[i].text.length;
    if (offset < seen) return i;
  }
  return lines.length - 1;
}

/** Selected source ids that are still ready sources; a source deleted elsewhere drops out. */
export function pruneSelection(selection: { ids: number[]; mode: "both" | "sources" | "recordings" }, readyIds: readonly number[]) {
  if (selection.ids.length === 0) return selection;
  const ready = new Set(readyIds);
  const ids = selection.ids.filter((id) => ready.has(id));
  if (ids.length === selection.ids.length) return selection;
  // Every chosen source is gone: back to "all sources" rather than an empty list the person cannot see.
  return { ...selection, ids };
}

/** Two minutes without progress while the server still shows work: the app was closed mid-way. */
export function isSourceStalled(source: { status: string; updatedAt: string | Date }, now: number): boolean {
  if (source.status === "ready" || source.status === "failed") return false;
  return now - new Date(source.updatedAt).getTime() > 2 * 60 * 1000;
}

export { USAGE_LIMIT_SENTENCE };

/** A plain sentence for a failed request. A usage limit never links to plans or purchases. */
export function sourceErrorText(error: unknown): string {
  if (error instanceof TRPCClientError) {
    if (error.data?.usageLimit) return USAGE_LIMIT_SENTENCE;
    if (error.data?.code === "TOO_MANY_REQUESTS") return "You are going a little fast. Try again in a minute.";
    if (error.data?.code === "UNAUTHORIZED") return "Your session ended. Sign in again.";
    if (/Failed to fetch|Network request failed/i.test(error.message)) return "Can't reach StudyScribe. Check your connection.";
    if (error.data?.zodError) return "Something went wrong. Please try again.";
    return error.message || "Something went wrong. Please try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

/** The line under an Ask answer when study sources were part of the search; null keeps today's wording. */
export function searchedLine(meta: { askedSources: boolean; searchedSources?: number; searched: number }): string | null {
  if (!meta.askedSources || meta.searchedSources === undefined) return null;
  const sources = meta.searchedSources;
  const recordings = meta.searched;
  if (sources === 0 && recordings === 0) return "Nothing in your sources or recordings matched.";
  const s = `${sources} ${sources === 1 ? "source" : "sources"}`;
  const r = `${recordings} ${recordings === 1 ? "recording" : "recordings"}`;
  return `Searched ${s} and ${r}.`;
}

/** The accessibility label of a source citation chip. */
export function sourceCitationLabel(n: number, title: string, place: string): string {
  return `Source ${n}: ${title}${place ? `, ${place}` : ""}`;
}

/** "2.4 MB", "310 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
