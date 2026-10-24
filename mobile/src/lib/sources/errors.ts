// Mirrors describeError in client/src/contexts/SourceUploadsContext.tsx; keep in step.
// Raw server text is never shown, except the plain cap sentences the server writes for people.
import { TRPCClientError } from "@trpc/client";
import { failureReasonOf, failureText, type FailureReason, type SourceKind } from "./model";
import type { SourceFileError } from "./pipeline";

export type UploadRowError =
  | { kind: "file"; code: SourceFileError }
  | { kind: "reason"; code: FailureReason }
  | { kind: "usageLimit" }
  | { kind: "rateLimited" }
  | { kind: "stillReading" }
  | { kind: "notSetUp" }
  | { kind: "offline" }
  /** Restored after a relaunch with no recorded cause: stays put until the person taps Retry. */
  | { kind: "paused" }
  | { kind: "message"; text: string };

/** The server marked the source failed while reading it; its short sentence says why. */
export class SourceFailedError extends Error {
  constructor(
    message: string | null,
    readonly kind?: SourceKind,
  ) {
    super(message ?? "This file could not be read");
    this.name = "SourceFailedError";
  }
}

/** Another request is still reading the source. Trying again waits for it. */
export class SourceStillReadingError extends Error {
  constructor() {
    super("This file is still being read");
    this.name = "SourceStillReadingError";
  }
}

/** The usage-limit marker the server's error formatter adds, or null. */
export function usageLimitOf(error: unknown): { kind: string } | null {
  if (!(error instanceof TRPCClientError)) return null;
  return (error.data as { usageLimit?: { kind: string } | null } | undefined)?.usageLimit ?? null;
}

const NETWORK = /Failed to fetch|Network request failed|network|timed out|connection|offline|could not be completed/i;

/** Turns whatever went wrong into a row error. A refused request (429, a plan limit) stays resumable. */
/** Plain cap sentences the server writes for people (study source count, per-course count, storage). Shown as written. */
const CAP_SENTENCE = /keep up to|storage limit|can hold up to|storage is nearly full/i;

export function describeError(error: unknown): UploadRowError {
  if (usageLimitOf(error)) return { kind: "usageLimit" };
  if (error instanceof SourceFailedError) return { kind: "reason", code: failureReasonOf(error.message, error.kind) };
  if (error instanceof SourceStillReadingError) return { kind: "stillReading" };
  const message = error instanceof Error ? error.message : "";
  if (/not set up on this server/i.test(message)) return { kind: "notSetUp" };
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | undefined)?.code;
    if (code === "TOO_MANY_REQUESTS") return { kind: "rateLimited" };
    if (!code && /Failed to fetch|Network request failed/i.test(message)) return { kind: "offline" };
    if (message && CAP_SENTENCE.test(message)) return { kind: "message", text: message };
    const reason = failureReasonOf(message);
    if (reason !== "failed") return { kind: "reason", code: reason };
    if (code === "BAD_REQUEST" && message) return { kind: "message", text: message };
    if (message && /sources? (in|per)|keep up to|storage/i.test(message)) return { kind: "message", text: message };
    return { kind: "reason", code: "failed" };
  }
  if (error instanceof Error && NETWORK.test(message)) return { kind: "offline" };
  return { kind: "reason", code: "failed" };
}

const FILE_ERRORS: Record<SourceFileError, string> = {
  unsupportedType: "Upload a PDF, PowerPoint (.pptx), Word (.docx), .txt or .md file.",
  legacyType: "Old .doc and .ppt files are not supported. Save it as .docx or .pptx first.",
  empty: "That file is empty.",
  tooLarge: "Files can be up to 25MB, and text files up to 2MB.",
};

export function fileErrorText(code: SourceFileError): string {
  return FILE_ERRORS[code];
}

/** The sentence a row or toast shows for an error. */
export function rowErrorText(error: UploadRowError): string {
  switch (error.kind) {
    case "file":
      return fileErrorText(error.code);
    case "reason":
      return failureText(error.code);
    case "usageLimit":
      return "You have reached this month's allowance. It resets on the first of the month.";
    case "rateLimited":
      return "You are going a little fast. Try again in a minute.";
    case "stillReading":
      return "This file is still being read. Try again in a moment.";
    case "notSetUp":
      return "Study sources are not available yet.";
    case "offline":
      return "Can't reach StudyScribe. Check your connection, then retry.";
    case "paused":
      return "Paused. Tap Retry to continue.";
    case "message":
      return error.text;
  }
}

/** Only these can be tried again from the same file or source. */
export function isRetryableError(error: UploadRowError): boolean {
  if (error.kind === "file" || error.kind === "notSetUp") return false;
  if (error.kind === "reason") return error.code === "failed";
  return true;
}
