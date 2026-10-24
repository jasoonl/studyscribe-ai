// Mirrors client/src/lib/sourceModel.ts; keep in step. Copy is English only (the app has no i18n).
import { MAX_SOURCE_BYTES, MAX_SOURCE_TEXT_BYTES, SOURCE_EXTENSIONS } from "@shared/const";

export type SourceKind = "pdf" | "pptx" | "docx" | "text";
export type SourceStatus = "uploaded" | "extracting" | "extracted" | "analyzing" | "ready" | "failed";

export type SourceLimits = { maxBytes: number; maxTextBytes: number; extensions: string[] };

export const SOURCE_LIMITS: SourceLimits = {
  maxBytes: MAX_SOURCE_BYTES,
  maxTextBytes: MAX_SOURCE_TEXT_BYTES,
  extensions: Object.keys(SOURCE_EXTENSIONS),
};

/** What the person sees for a source: the server status folded into stages. */
export type SourceStage = "waiting" | "reading" | "summarizing" | "ready" | "failed";

export function stageOf(status: SourceStatus): SourceStage {
  switch (status) {
    case "uploaded":
      return "waiting";
    case "extracting":
      return "reading";
    case "extracted":
    case "analyzing":
      return "summarizing";
    case "ready":
      return "ready";
    default:
      return "failed";
  }
}

/** Percent of the summary work done, or null while the part count is not known yet. */
export function summaryPercent(source: { partCount: number; partsDone: number; status: SourceStatus }): number | null {
  if (source.status === "ready") return 100;
  if (!source.partCount || source.partCount <= 0) return null;
  return Math.min(99, Math.round((source.partsDone / source.partCount) * 100));
}

export type FailureReason = "needsOcr" | "noText" | "password" | "empty" | "encoding" | "tooLarge" | "tooLong" | "unreadable" | "limitReached" | "failed";

/**
 * Maps the server's short failure sentence (server/sourceExtract.ts) to a reason the app words
 * itself, so no raw server text is shown. `kind` matters for one sentence: "No text could be
 * found" is scan advice only for a PDF.
 */
export function failureReasonOf(message: string | null | undefined, kind?: SourceKind): FailureReason {
  const text = (message ?? "").toLowerCase();
  if (!text) return "failed";
  // The server's generic sentence for an unexplained read failure ("It may be damaged") is worth another try.
  if (text.includes("we could not read this file")) return "failed";
  if (text.includes("password")) return "password";
  if (text.includes("selectable text") || text.includes("scanned")) return "needsOcr";
  if (text.includes("no text could be found") || text.includes("no readable text") || text.includes("no text")) return kind && kind !== "pdf" ? "noText" : kind === "pdf" ? "needsOcr" : "noText";
  if (text.includes("is empty")) return "empty";
  if (text.includes("utf-8") || text.includes("not plain text")) return "encoding";
  if (text.includes("too large") || text.includes("larger than")) return "tooLarge";
  if (text.includes("characters of text") || text.includes("pages, slides or sections") || text.includes("the limit is") || text.includes("took too long") || text.includes("too many") || text.includes("too long")) return "tooLong";
  if (
    text.includes("damaged") ||
    text.includes("not a real") ||
    text.includes("does not look like") ||
    text.includes("could not be opened") ||
    text.includes("could not be read") ||
    text.includes("could not read") ||
    text.includes("unreadable") ||
    text.includes("corrupt") ||
    text.includes("not a valid") ||
    text.includes("does not match")
  )
    return "unreadable";
  if (text.includes("limit") || text.includes("allowance")) return "limitReached";
  return "failed";
}

/** Only an unexplained failure is worth trying again; the others need a different file. */
export function isRetryableReason(reason: FailureReason): boolean {
  return reason === "failed";
}

const FAILURE_TEXT: Record<FailureReason, string> = {
  needsOcr: "This PDF has no selectable text. Scanned PDFs are not supported yet. Upload a version with real text.",
  noText: "No text could be found in this file.",
  password: "This PDF is password protected. Remove the password and upload it again.",
  empty: "That file is empty.",
  encoding: "This text file is not plain UTF-8 text. Save it as UTF-8 and try again.",
  tooLarge: "That file is larger than the size limit.",
  tooLong: "This file is too long to read. Upload a shorter part of it.",
  unreadable: "This file is damaged or could not be read. Save it again from the original app and upload that.",
  limitReached: "You have reached this month's allowance. It resets on the first of the month.",
  failed: "Something went wrong while reading this file. Try again.",
};

export function failureText(reason: FailureReason): string {
  return FAILURE_TEXT[reason];
}

const KIND_LABELS: Record<SourceKind, string> = { pdf: "PDF", pptx: "Slides", docx: "Document", text: "Notes" };

export function kindLabel(kind: SourceKind): string {
  return KIND_LABELS[kind];
}

export type SourceFlag = {
  id: number;
  unitIndex: number;
  label: string;
  kind: "definition" | "formula" | "date" | "example" | "exam_point";
  text: string;
  quote: string | null;
  importance: number;
};

/** "Likely on a test" means flagged as an exam point or rated 2 or 3 of 3. */
export function isLikelyOnTest(flag: Pick<SourceFlag, "kind" | "importance">): boolean {
  return flag.kind === "exam_point" || flag.importance >= 2;
}

export function filterFlags<T extends Pick<SourceFlag, "kind" | "importance">>(flags: readonly T[], filter: "all" | "test"): T[] {
  return filter === "test" ? flags.filter(isLikelyOnTest) : [...flags];
}

export function stageWord(stage: SourceStage): string {
  switch (stage) {
    case "waiting":
      return "Waiting";
    case "reading":
      return "Reading";
    case "summarizing":
      return "Summarizing";
    case "ready":
      return "Ready";
    default:
      return "Failed";
  }
}

/** "3.2MB", "840KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
