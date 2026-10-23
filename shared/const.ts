export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// Per-recording size caps, shared so the UI text and the server checks can't drift.
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "1GB";
export const MAX_LINK_IMPORT_BYTES = 500 * 1024 * 1024;
export const MAX_LINK_IMPORT_LABEL = "500MB";

// Study sources (Phase 8): documents a student uploads per course. Shared so the
// upload screen's text and the server checks can't drift.
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_SOURCE_LABEL = "25MB";
/** Plain-text and Markdown files are capped lower: they are all text, so 2MB is already ~2 million characters. */
export const MAX_SOURCE_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_TEXT_LABEL = "2MB";
export const MAX_SOURCES_PER_USER = 60;
export const MAX_SOURCES_PER_COURSE = 25;
export const MAX_SOURCE_BYTES_PER_USER = 250 * 1024 * 1024;
export const MAX_SOURCE_BYTES_PER_USER_LABEL = "250MB";
/** Pages, slides or sections kept from one source. */
export const MAX_SOURCE_UNITS = 400;
/** Extracted characters kept from one source. */
export const MAX_SOURCE_CHARS = 400_000;

export type StudySourceKind = "pdf" | "pptx" | "docx" | "text";

/** Accepted extensions (lower case, no dot) and the kind each becomes. Legacy .doc and .ppt are deliberately absent. */
export const SOURCE_EXTENSIONS: Record<string, StudySourceKind> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
  txt: "text",
  md: "text",
  markdown: "text",
};

/** The file picker's `accept` value. */
export const SOURCE_ACCEPT = Object.keys(SOURCE_EXTENSIONS).map(extension => `.${extension}`).join(",");

export function sourceKindForFileName(fileName: string): StudySourceKind | null {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(SOURCE_EXTENSIONS, extension) ? SOURCE_EXTENSIONS[extension] : null;
}
