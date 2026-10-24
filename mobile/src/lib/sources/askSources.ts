// Mirrors client/src/lib/askSources.ts (minus address parsing); keep in step.
import { sourceHref } from "./location";

/** What Ask searches: study sources and recordings (default), sources only, or recordings only. */
export type AskMode = "both" | "sources" | "recordings";
export const ASK_MODES: readonly AskMode[] = ["both", "sources", "recordings"];

export type AskSourceSelection = { ids: number[]; mode: AskMode };

export const emptySelection: AskSourceSelection = { ids: [], mode: "both" };

/** The fields `ai.askAcrossRecordings` takes for a selection. */
export function askRequestOptions(selection: AskSourceSelection): { includeSources: boolean; includeRecordings: boolean; sourceIds?: number[] } {
  const includeSources = selection.mode !== "recordings";
  const includeRecordings = selection.mode !== "sources";
  return {
    includeSources,
    includeRecordings,
    ...(includeSources && selection.ids.length > 0 ? { sourceIds: selection.ids } : {}),
  };
}

export type PickerLabel = { key: "all" | "some" | "recordingsOnly" | "none"; count: number };

/** The picker chip's wording: all sources in the course, N sources, or recordings only. */
export function pickerLabel(selection: AskSourceSelection, available: number): PickerLabel {
  if (selection.mode === "recordings") return { key: "recordingsOnly", count: 0 };
  if (selection.ids.length > 0) return { key: "some", count: selection.ids.length };
  return available > 0 ? { key: "all", count: available } : { key: "none", count: 0 };
}

/** A short run of the cited passage to highlight on the page: no ellipses, cut at a word. */
export function quoteFromSnippet(snippet: string, max = 80): string {
  const clean = snippet.replace(/^[\s.…]+|[\s.…]+$/g, "").replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 30 ? cut.slice(0, space) : cut).trim();
}

export type AskCitation = {
  n: number;
  recordingId: number;
  title: string;
  start: number | null;
  snippet: string;
  sourceId?: number;
  location?: string;
  unitIndex?: number;
};

/** Where a citation opens: a source at its page, or a recording at its moment. */
export function citationLink(citation: AskCitation): string {
  if (citation.sourceId) {
    return sourceHref(citation.sourceId, { unitIndex: citation.unitIndex ?? null, quote: quoteFromSnippet(citation.snippet) });
  }
  return citation.start === null ? `/recording/${citation.recordingId}` : `/recording/${citation.recordingId}?t=${Math.floor(citation.start)}`;
}
