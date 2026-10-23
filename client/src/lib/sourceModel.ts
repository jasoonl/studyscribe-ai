import { MAX_SOURCE_BYTES, MAX_SOURCE_TEXT_BYTES, SOURCE_EXTENSIONS } from "@shared/const";
import type { SourceLimits } from "./sourceUpload";

export type SourceKind = "pdf" | "pptx" | "docx" | "text";
export type SourceStatus = "uploaded" | "extracting" | "extracted" | "analyzing" | "ready" | "failed";

/** The fields of a study source the list and cards use. */
export type SourceSummary = {
  id: number;
  courseId: number | null;
  title: string;
  fileName: string;
  kind: SourceKind;
  status: SourceStatus;
  sizeBytes: number;
  unitCount: number;
  partCount: number;
  partsDone: number;
  errorMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export const SOURCE_LIMITS: SourceLimits = {
  maxBytes: MAX_SOURCE_BYTES,
  maxTextBytes: MAX_SOURCE_TEXT_BYTES,
  extensions: Object.keys(SOURCE_EXTENSIONS),
};

/** What the person sees for a source: the server status folded into the stages the plan names. */
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
export function summaryPercent(source: Pick<SourceSummary, "partCount" | "partsDone" | "status">): number | null {
  if (source.status === "ready") return 100;
  if (!source.partCount || source.partCount <= 0) return null;
  return Math.min(99, Math.round((source.partsDone / source.partCount) * 100));
}

export type FailureReason = "needsOcr" | "tooLarge" | "tooLong" | "unreadable" | "limitReached" | "failed";

/** Maps the server's short failure sentence to a reason the UI words itself, so no raw server text is shown. */
export function failureReasonOf(message: string | null | undefined): FailureReason {
  const text = (message ?? "").toLowerCase();
  if (!text) return "failed";
  if (text.includes("selectable text") || text.includes("scanned") || text.includes("no readable text") || text.includes("no text")) return "needsOcr";
  if (text.includes("too large") || text.includes("larger than") || text.includes("size")) return "tooLarge";
  if (text.includes("too many") || text.includes("pages") || text.includes("characters") || text.includes("too long")) return "tooLong";
  if (text.includes("unreadable") || text.includes("corrupt") || text.includes("could not read") || text.includes("not a valid") || text.includes("does not match")) return "unreadable";
  if (text.includes("limit") || text.includes("allowance")) return "limitReached";
  return "failed";
}

export function kindLabelKey(kind: SourceKind) {
  return `sources.kind.${kind}` as const;
}
