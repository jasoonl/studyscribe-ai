import { DEFAULT_ORIGIN, originPermissionPattern } from "./lib/origin";

/**
 * The extension's manifest. Permissions are the minimum the two features need:
 * - activeTab: the current tab's address and title, only after the person
 *   opens the extension on it;
 * - tabCapture + offscreen: record that tab's audio in a document that keeps
 *   running while the popup is closed;
 * - storage: the chosen site address and recorder state.
 * Host access is the StudyScribe site only. Another address (a self-hosted
 * copy, or a local server) is requested at runtime from the settings page.
 */
export function buildManifest(options: { version: string; devOrigin?: string }) {
  const hostPermissions = [originPermissionPattern(DEFAULT_ORIGIN)];
  if (options.devOrigin) hostPermissions.push(originPermissionPattern(options.devOrigin));
  const icons = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };
  return {
    manifest_version: 3,
    name: options.devOrigin ? "StudyScribe AI (development)" : "StudyScribe AI",
    short_name: "StudyScribe",
    description: "Record a tab's audio or import the lecture page you are on into StudyScribe for transcripts, notes and flashcards.",
    version: options.version,
    minimum_chrome_version: "116",
    icons,
    action: { default_popup: "popup.html", default_title: "StudyScribe", default_icon: icons },
    background: { service_worker: "background.js", type: "module" },
    options_ui: { page: "options.html", open_in_tab: true },
    permissions: ["activeTab", "tabCapture", "offscreen", "storage"],
    host_permissions: hostPermissions,
    optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };
}
