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

export type FailureReason = "needsOcr" | "noText" | "password" | "empty" | "encoding" | "tooLarge" | "tooLong" | "unreadable" | "limitReached" | "failed";

/**
 * Maps the server's short failure sentence (written in server/sourceExtract.ts) to a reason the UI
 * words itself, so no raw server text is shown. `kind` matters for one sentence: "No text could be
 * found" is scan advice only for a PDF.
 */
export function failureReasonOf(message: string | null | undefined, kind?: SourceKind): FailureReason {
  const text = (message ?? "").toLowerCase();
  if (!text) return "failed";
  if (text.includes("password")) return "password";
  if (text.includes("selectable text") || text.includes("scanned")) return "needsOcr";
  if (text.includes("no text could be found") || text.includes("no readable text") || text.includes("no text")) return kind && kind !== "pdf" ? "noText" : kind === "pdf" ? "needsOcr" : "noText";
  if (text.includes("is empty")) return "empty";
  if (text.includes("utf-8") || text.includes("not plain text")) return "encoding";
  if (text.includes("too large") || text.includes("larger than")) return "tooLarge";
  if (text.includes("characters of text") || text.includes("pages, slides or sections") || text.includes("the limit is") || text.includes("took too long") || text.includes("too many") || text.includes("too long")) return "tooLong";
  // The server's generic catch-all: the cause is unknown and trying again can work.
  if (text.includes("we could not read this file")) return "failed";
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
  return "failed";
}

/** Only an unexplained failure is worth trying again; the others need a different file. */
export function isRetryableReason(reason: FailureReason): boolean {
  return reason === "failed";
}

export function kindLabelKey(kind: SourceKind) {
  return `sources.kind.${kind}` as const;
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
