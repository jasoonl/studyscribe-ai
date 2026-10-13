import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
  type MenuItemConstructorOptions,
  type Rectangle,
  type WebContents,
} from "electron";
import { existsSync, readFileSync } from "node:fs";
import { release } from "node:os";
import { join, resolve } from "node:path";
import {
  compactBounds,
  deepLinkPath,
  findDeepLink,
  isAllowedNavigation,
  isAllowedPermission,
  isAppUrl,
  isExternalLink,
  PROTOCOL,
  resolveOrigin,
  studyHelpPath,
} from "./lib/policy";
import { loopbackFor, pickScreen, systemAudioSupport } from "./lib/systemAudio";

/**
 * StudyScribe for desktop (roadmap E7): the production web app in a locked-down
 * window, plus what a browser tab cannot do, system audio for the recorder's
 * "Add tab or screen audio" and an always-on-top Study help window.
 */

const isMac = process.platform === "darwin";
const support = systemAudioSupport(process.platform, release());

// Every renderer is sandboxed. The only exception is an explicit --no-sandbox, which Chromium
// requires when run as root (containers, CI); the app is never launched that way normally.
if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();

function settingsPath() {
  return join(app.getPath("userData"), "settings.json");
}

/** `{ "origin": "https://…" }` in the app's data folder points the app at another StudyScribe server. */
function readSettings(): { origin?: string } {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

const origin = resolveOrigin({ argv: process.argv, env: process.env.STUDYSCRIBE_URL, saved: readSettings().origin });

let mainWindow: BrowserWindow | null = null;
let compact: { bounds: Rectangle; maximized: boolean } | null = null;
let pendingPath: string | null = null;

/* ---------- Single instance and studyscribe:// links ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
  const initialLink = findDeepLink(process.argv);
  pendingPath = initialLink ? deepLinkPath(initialLink) : null;
}

function handleDeepLink(link: string) {
  const path = deepLinkPath(link);
  if (!path) return;
  if (!mainWindow) {
    pendingPath = path;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  navigateInApp(path);
}

// macOS delivers links through open-url, which can arrive before the app is ready.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on("second-instance", (_event, argv) => {
  const link = findDeepLink(argv);
  if (link) handleDeepLink(link);
  else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/**
 * Moves within the single-page app without reloading it, so a recording in
 * progress (it lives in the page) is never interrupted. wouter follows
 * history.pushState plus a popstate event.
 */
function navigateInApp(path: string) {
  const window = mainWindow;
  if (!window) return;
  const target = new URL(path, origin).href;
  if (!isAppUrl(window.webContents.getURL(), origin)) {
    void window.loadURL(target);
    return;
  }
  void window.webContents.executeJavaScript(
    `history.pushState(null, "", ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent("popstate"));`,
    true,
  );
}

/* ---------- Navigation and window guards ---------- */

function openExternally(url: string) {
  if (isExternalLink(url)) void shell.openExternal(url);
}

function guard(contents: WebContents) {
  contents.on("will-attach-webview", event => event.preventDefault());
  const onNavigate = (event: Electron.Event, url: string) => {
    if (isAllowedNavigation(url, origin)) return;
    event.preventDefault();
    openExternally(url);
  };
  contents.on("will-navigate", onNavigate);
  contents.on("will-redirect", onNavigate);
  contents.setWindowOpenHandler(({ url }) => {
    // Links to other sites, and the site's own target=_blank links, open in the browser; the app keeps one window.
    openExternally(url);
    return { action: "deny" };
  });
}

app.on("web-contents-created", (_event, contents) => guard(contents));

/* ---------- Permissions and system audio ---------- */

function configureSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? ((details.mediaTypes ?? []) as string[]) : [];
    callback(isAllowedPermission(permission, details.requestingUrl, origin, mediaTypes));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => isAllowedPermission(permission, requestingOrigin, origin));

  // The record page's "Add tab or screen audio" calls getDisplayMedia; answer it with the system's audio.
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const window = mainWindow;
      const requester = request.frame?.url ?? "";
      if (!window || !isAppUrl(requester, origin) || !support.available) {
        callback({});
        return;
      }
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        buttons: ["Record system audio", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: "Record your computer's audio?",
        detail:
          "StudyScribe will record what this computer plays, such as a video or an online class, together with your microphone, until you stop recording. Only record people who know they are being recorded.",
      });
      if (choice.response !== 0) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
        const display = screen.getDisplayMatching(window.getBounds());
        const source = pickScreen(sources, display.id);
        if (!source) {
          callback({});
          return;
        }
        // The web app stops the video track at once; only the audio is recorded.
        callback({ video: source, audio: loopbackFor(support) });
      } catch (error) {
        console.error("[desktop] screen source lookup failed", error);
        callback({});
      }
    },
    // macOS 15+: show the system's own picker, which also covers audio.
    { useSystemPicker: true },
  );
}

/* ---------- Study help: the window becomes a compact, always-on-top panel ---------- */

function setStudyHelp(on: boolean) {
  const window = mainWindow;
  if (!window || on === Boolean(compact)) return;
  if (on) {
    compact = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
    if (window.isFullScreen()) window.setFullScreen(false);
    if (window.isMaximized()) window.unmaximize();
    const display = screen.getDisplayMatching(window.getBounds());
    window.setMinimumSize(320, 420);
    window.setBounds(compactBounds(display.workArea), true);
    window.setAlwaysOnTop(true, "floating");
    // Stay visible over a full-screen video call on macOS.
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const path = studyHelpPath(window.webContents.getURL(), origin);
    if (path) navigateInApp(path);
  } else {
    const previous = compact!;
    compact = null;
    window.setAlwaysOnTop(false);
    window.setVisibleOnAllWorkspaces(false);
    window.setMinimumSize(360, 480);
    window.setBounds(previous.bounds, true);
    if (previous.maximized) window.maximize();
  }
  window.webContents.send("desktop:study-help", on);
  buildMenu();
}

/* ---------- IPC from the preload bridge ---------- */

function fromApp(event: Electron.IpcMainInvokeEvent) {
  return Boolean(event.senderFrame && isAppUrl(event.senderFrame.url, origin));
}

ipcMain.handle("desktop:info", event => {
  if (!fromApp(event)) return null;
  return { appVersion: app.getVersion(), origin, systemAudio: support, studyHelp: Boolean(compact) };
});
ipcMain.handle("desktop:study-help", (event, on: unknown) => {
  if (!fromApp(event)) return false;
  setStudyHelp(typeof on === "boolean" ? on : !compact);
  return Boolean(compact);
});
ipcMain.handle("desktop:retry", event => {
  // Sent by the offline page, which is a local file.
  if (!event.senderFrame?.url.startsWith("file://")) return;
  void mainWindow?.loadURL(new URL("/dashboard", origin).href);
});

/* ---------- Menu ---------- */

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Recording", accelerator: "CmdOrCtrl+N", click: () => navigateInApp("/record") },
        { label: "Library", accelerator: "CmdOrCtrl+L", click: () => navigateInApp("/dashboard") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Study Help Window",
          type: "checkbox",
          checked: Boolean(compact),
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => setStudyHelp(!compact),
        },
        { type: "separator" },
        { label: "Back", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: () => mainWindow?.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: () => mainWindow?.webContents.navigationHistory.goForward() },
        { role: "reload" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "StudyScribe Website", click: () => void shell.openExternal(origin) },
        { label: "Privacy Policy", click: () => void shell.openExternal(new URL("/privacy", origin).href) },
        { label: `System Audio: ${support.note}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Updates (off until a feed is configured) ---------- */

async function checkForUpdates() {
  const feed = process.env.STUDYSCRIBE_UPDATE_URL;
  if (!app.isPackaged || !feed) {
    console.log("[desktop] Updates are off: set STUDYSCRIBE_UPDATE_URL to a release feed to turn them on.");
    return;
  }
  try {
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.setFeedURL({ provider: "generic", url: feed });
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    console.error("[desktop] Update check failed", error);
  }
}

/* ---------- Window ---------- */

function createWindow() {
  const icon = join(__dirname, "..", "build", "icon.png");
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    title: "StudyScribe",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d1221" : "#f8fafd",
    ...(process.platform === "linux" && existsSync(icon) ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  });
  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
    compact = null;
  });
  // The web app asks before unloading while a recording is live; Electron would otherwise refuse silently.
  window.webContents.on("will-prevent-unload", event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      buttons: ["Leave", "Stay"],
      defaultId: 1,
      cancelId: 1,
      message: "A recording is in progress",
      detail: "If you leave now, the recording stops. Anything not yet saved is kept on this computer and offered back the next time you open the record page.",
    });
    if (choice === 0) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    // -3 is an aborted load (a redirect or a navigation the guard stopped), not a failure.
    if (!isMainFrame || code === -3 || !isAppUrl(url, origin)) return;
    void window.loadFile(join(__dirname, "..", "static", "offline.html"), { query: { origin } });
  });
  void window.loadURL(new URL(pendingPath ?? "/dashboard", origin).href);
  pendingPath = null;
}

app.whenReady().then(() => {
  configureSession();
  buildMenu();
  createWindow();
  void checkForUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
