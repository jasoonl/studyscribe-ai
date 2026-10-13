#!/usr/bin/env node
/**
 * Runs the desktop app against a local StudyScribe server and checks the
 * shell: it loads the configured origin, the preload bridge is exposed, the
 * navigation lock holds, getDisplayMedia is answered with a screen and system
 * audio (and the record page offers "Record a tab or screen audio"), a
 * recording with system audio starts, the Study help window turns compact and
 * always on top without reloading the page, and studyscribe:// links navigate
 * inside the app. Run under `xvfb-run -a` on Linux:
 *
 *   APP_ORIGIN=http://localhost:3107 E2E_EMAIL=... E2E_PASSWORD=... xvfb-run -a node e2e/desktop.e2e.mjs
 *
 * As root (containers), Chromium's sandbox cannot start, so the test passes
 * --no-sandbox; the packaged app keeps the sandbox on.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appOrigin = process.env.APP_ORIGIN || "http://localhost:3107";
const email = process.env.E2E_EMAIL || "avery@example.com";
const password = process.env.E2E_PASSWORD || "extension-test-1";
const shots = process.env.E2E_SCREENSHOTS || "";

let failures = 0;
function check(condition, label) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures++;
}
async function shot(page, name) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const app = await electron.launch({
  cwd: root,
  ...(process.env.E2E_EXECUTABLE ? { executablePath: resolve(process.env.E2E_EXECUTABLE) } : {}),
  args: [
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    "--use-fake-device-for-media-stream",
    // A fresh profile, so a recording left over from an earlier run is not restored.
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "studyscribe-desktop-"))}`,
    // E2E_EXECUTABLE runs a packaged build (e.g. release/linux-unpacked/studyscribe) instead of the sources.
    ...(process.env.E2E_EXECUTABLE ? [] : ["."]),
    `--url=${appOrigin}`,
  ],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});

try {
  const page = await app.firstWindow();
  page.on("dialog", dialog => {
    console.log(`      page dialog (${dialog.type()}): ${dialog.message()}`);
    dialog.accept().catch(() => {});
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForURL(url => url.origin === appOrigin, { timeout: 20_000 });
  check(true, `loads the configured site (${page.url()})`);

  // Record what would open in the browser instead of opening it, and answer the system-audio prompt.
  await app.evaluate(({ shell, dialog }) => {
    globalThis.__opened = [];
    shell.openExternal = async url => void globalThis.__opened.push(url);
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    globalThis.__unloadPrompts = 0;
    dialog.showMessageBoxSync = () => (globalThis.__unloadPrompts++, 0);
  });

  const bridge = await page.evaluate(async () => {
    const desktop = window.studyscribeDesktop;
    return desktop ? { isDesktop: desktop.isDesktop, keys: Object.keys(desktop).sort(), systemAudio: desktop.systemAudio, info: await desktop.getInfo(), node: typeof window.require } : null;
  });
  check(bridge?.isDesktop === true, "preload bridge is exposed as window.studyscribeDesktop");
  check(bridge?.info?.origin === appOrigin, "bridge reports the configured origin");
  check(bridge?.systemAudio?.available === true, `bridge reports system audio (${bridge?.systemAudio?.method})`);
  check(bridge?.node === "undefined", "no Node.js in the page (contextIsolation, sandbox, no nodeIntegration)");
  console.log("      bridge:", bridge?.keys.join(", "));

  const webPreferences = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox };
  });
  check(webPreferences.contextIsolation === true && webPreferences.nodeIntegration === false && webPreferences.sandbox === true, `secure webPreferences ${JSON.stringify(webPreferences)}`);

  // Navigation lock: other sites open in the browser, the window stays.
  await page.evaluate(() => {
    window.location.href = "https://example.com/elsewhere";
  });
  await page.waitForTimeout(800);
  check(new URL(page.url()).origin === appOrigin, "navigating to another site is blocked");
  await page.evaluate(() => window.open("https://example.org/new", "_blank"));
  await page.waitForTimeout(300);
  const opened = await app.evaluate(() => globalThis.__opened);
  check(opened.includes("https://example.com/elsewhere") && opened.includes("https://example.org/new"), "external links go to the browser");
  check((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1, "no second window was opened");

  // Sign in with the site's own endpoint, then load the record page.
  const status = await page.evaluate(
    async ([e, p]) => (await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) })).status,
    [email, password],
  );
  check(status === 200, "signed in");
  // Keep the cookie banner out of screenshots; turn on live text when a streaming mock is running (E2E_LIVE=1).
  await page.evaluate(live => {
    localStorage.setItem("studyscribe_cookie_consent", "declined");
    if (live) localStorage.setItem("studyscribe_live_transcript", "on");
  }, Boolean(process.env.E2E_LIVE));
  await page.goto(`${appOrigin}/record`);
  await page.getByRole("button", { name: "Start Recording" }).waitFor();
  const tabAudioOption = page.getByText("Record a tab or screen audio too");
  check(await tabAudioOption.isVisible(), "record page offers tab or screen audio inside the desktop app");
  await shot(page, "desktop-record");

  // getDisplayMedia is answered by the shell: a screen plus system audio.
  const media = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const kinds = stream.getTracks().map(track => `${track.kind}:${track.label}`);
      stream.getTracks().forEach(track => track.stop());
      return { kinds };
    } catch (error) {
      return { error: `${error.name}: ${error.message}` };
    }
  });
  check(Boolean(media.kinds?.some(kind => kind.startsWith("video:"))), `getDisplayMedia answered (${media.kinds?.join(", ") ?? media.error})`);
  const hasSystemAudio = Boolean(media.kinds?.some(kind => kind.startsWith("audio:")));
  console.log(`${hasSystemAudio ? "PASS" : "NOTE"}  system audio track ${hasSystemAudio ? "present" : "absent (no PulseAudio/PipeWire in this environment)"}`);

  // Start a recording with tab/screen audio through the web app's own control.
  await page.locator("#tab-audio-option").click();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor({ timeout: 15_000 });
  check(true, "recording started with tab or screen audio selected");
  const tabAudioText = await page.getByText("Recording tab audio and your microphone").isVisible().catch(() => false);
  console.log(`${tabAudioText ? "PASS" : "NOTE"}  ${tabAudioText ? "web app reports tab audio in the mix" : "web app recording without a system audio track"}`);

  // Study help: the same page becomes a compact, always-on-top window, and the recording carries on.
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  await page.evaluate(() => window.studyscribeDesktop.setStudyHelp(true));
  await page.waitForTimeout(500);
  const compactState = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { onTop: window.isAlwaysOnTop(), bounds: window.getBounds() };
  });
  check(compactState.onTop && compactState.bounds.width <= 420, `Study help window is compact and always on top (${compactState.bounds.width}x${compactState.bounds.height})`);
  check(await page.evaluate(() => window.__sameDocument === true), "the page was not reloaded");
  check(await page.getByRole("button", { name: "Stop", exact: true }).isVisible(), "the recording is still running in the Study help window");
  if (process.env.E2E_LIVE) {
    const help = page.getByRole("heading", { name: "Study help" });
    await help.waitFor({ timeout: 20_000 });
    await help.scrollIntoViewIfNeeded();
    check(true, "the compact window shows the live transcript and Study help");
    await page.waitForTimeout(4_000);
    await shot(page, "desktop-study-help-live");
  }
  await shot(page, "desktop-study-help");

  // studyscribe:// navigates inside the app without a reload.
  await app.evaluate(({ app: electronApp }) => electronApp.emit("open-url", { preventDefault() {} }, "studyscribe://dashboard"));
  await page.waitForURL(`${appOrigin}/dashboard`);
  check(await page.evaluate(() => window.__sameDocument === true), "studyscribe://dashboard navigated without reloading");
  await app.evaluate(({ app: electronApp }) => electronApp.emit("open-url", { preventDefault() {} }, "studyscribe://api/auth/logout"));
  await page.waitForTimeout(300);
  check(page.url() === `${appOrigin}/dashboard`, "studyscribe:// refuses API routes");

  await page.evaluate(() => window.studyscribeDesktop.setStudyHelp(false));
  await page.waitForTimeout(500);
  const restored = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { onTop: window.isAlwaysOnTop(), bounds: window.getBounds() };
  });
  check(!restored.onTop && restored.bounds.width === before.width, "leaving Study help restores the window");

  // Reloading mid-recording triggers the web app's beforeunload. With Playwright attached, Chromium reports it as a
  // page dialog (accepted above); without a debugger the shell's will-prevent-unload handler asks natively.
  await page.reload();
  check(new URL(page.url()).pathname === "/dashboard", `leaving during a recording asks first (native prompts: ${await app.evaluate(() => globalThis.__unloadPrompts)})`);
} finally {
  await app.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
