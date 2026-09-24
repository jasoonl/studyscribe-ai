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
