#!/usr/bin/env node
/**
 * Loads the unpacked development build in Chromium and drives it against a
 * local StudyScribe server. See extension/README.md ("End-to-end test") for
 * the server and mock commands. Needs a display: run under `xvfb-run -a` on
 * Linux (extensions do not load in the old headless mode).
 *
 *   APP_ORIGIN=http://localhost:3107 MOCK_ORIGIN=http://localhost:7090 \
 *   E2E_EMAIL=avery@example.com E2E_PASSWORD=... xvfb-run -a node e2e/extension.e2e.mjs
 *
 * Checks: sign-in detection (signed out, then signed in through the site's own
 * session cookie), "Import this page" reaching recordings.createFromUrl and
 * showing the server's answer, and "Record this tab" (tab audio, then tab plus
 * microphone) running with the popup closed, a badge timer, Stop from the
 * popup, upload, and recordings.create.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const appOrigin = process.env.APP_ORIGIN || "http://localhost:3107";
const mockOrigin = process.env.MOCK_ORIGIN || "http://localhost:7090";
const email = process.env.E2E_EMAIL || "avery@example.com";
const password = process.env.E2E_PASSWORD || "extension-test-1";
const shots = process.env.E2E_SCREENSHOTS || "";
const executablePath =
  process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(path => existsSync(path));

if (!existsSync(join(dist, "manifest.json"))) {
  console.log("Building the development extension");
  execFileSync("node", ["scripts/build.mjs", `--dev-origin=${appOrigin}`], { cwd: root, stdio: "inherit" });
}

/** Chrome derives an unpacked extension's id from its path: SHA-256, first 32 hex digits mapped onto a-p. */
function unpackedExtensionId(path) {
  return [...createHash("sha256").update(path).digest("hex").slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
}
const extensionId = unpackedExtensionId(dist);

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

const profile = mkdtempSync(join(tmpdir(), "studyscribe-ext-"));
// Automation cannot click Chrome's permission prompt, and grantPermissions refuses extension origins,
// so the profile starts with the microphone allowed for the extension, as if "Allow microphone" had been clicked.
mkdirSync(join(profile, "Default"), { recursive: true });
writeFileSync(
  join(profile, "Default", "Preferences"),
  JSON.stringify({ profile: { content_settings: { exceptions: { media_stream_mic: { [`chrome-extension://${extensionId}/,*`]: { setting: 1 } } } } } }),
);
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    // Lets the test capture a tab without clicking the toolbar icon, which automation cannot do.
    `--allowlisted-extension-id=${extensionId}`,
    "--autoplay-policy=no-user-gesture-required",
    // A fake microphone. (--use-fake-ui-for-media-stream is left out: it breaks tab capture in offscreen documents.)
    "--use-fake-device-for-media-stream",
  ],
});

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  check(worker.url() === `chrome-extension://${extensionId}/background.js`, `extension loaded (${extensionId})`);
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));

  // The lecture tab: a page on localhost (covered by the development build's host permission) playing a tone.
  const lecture = await context.newPage();
  await lecture.goto(`${mockOrigin}/lecture.html`);
  await lecture.waitForFunction(() => {
    const audio = document.getElementById("a");
    return audio && !audio.paused && audio.currentTime > 0.2;
  });
  const lectureTabId = await worker.evaluate(async url => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id, mockOrigin);
  check(Number.isInteger(lectureTabId), "lecture tab is playing audio");

  const popupUrl = `chrome-extension://${extensionId}/popup.html?tab=${lectureTabId}`;
  const openPopup = async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(popupUrl);
    return page;
  };

  // 1. Signed out.
  let popup = await openPopup();
  await popup.getByRole("heading", { name: "Sign in to StudyScribe" }).waitFor();
  check(true, "popup detects that nobody is signed in");
  await shot(popup, "popup-signed-out");
  await popup.close();

  // 2. Sign in on the site; the extension reuses its session cookie (SameSite=Lax).
  const site = await context.newPage();
  await site.goto(`${appOrigin}/login`);
  const login = await site.evaluate(
    async ([e, p]) => (await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) })).status,
    [email, password],
  );
  check(login === 200, "signed in on the site");
  const cookie = (await context.cookies(appOrigin)).find(c => c.name === "studyscribe_session");
  check(cookie?.sameSite === "Lax", `session cookie is SameSite=${cookie?.sameSite}`);
  await site.close();

  popup = await openPopup();
  await popup.locator("#account-email").waitFor();
  check((await popup.locator("#account-email").textContent()) === email, "popup shows the signed-in account");
  check((await popup.locator("#title").inputValue()) === "Lecture 7: Enzyme kinetics", "title defaults to the tab's title");
  await popup.getByRole("heading", { name: "Recent recordings" }).waitFor();
  await shot(popup, "popup-signed-in");

  // 3. Import this page: the server refuses a local address (its SSRF check), and the popup shows why.
  await popup.locator("#language").selectOption("es");
  await popup.getByRole("button", { name: "Import this page" }).click();
  const importStatus = popup.locator("#import-status");
  await importStatus.filter({ hasText: /private|local|not allowed|address|reach/i }).waitFor({ timeout: 30_000 });
  check(true, `import reached recordings.createFromUrl: "${(await importStatus.textContent()).trim().slice(0, 120)}"`);
  await shot(popup, "popup-import-result");
  await popup.getByRole("button", { name: "Dismiss" }).click();

  // 4. Record this tab (tab audio only), with the popup closed while it runs.
  await popup.locator("#title").fill("Enzyme kinetics, tab audio");
  await popup.getByRole("button", { name: "Record this tab" }).click();
  await popup.locator("#timer, #record-result, #form-message:not(:empty)").first().waitFor();
  if (!(await popup.locator("#timer").count())) {
    throw new Error(`Recording did not start: ${await popup.locator("#record-result, #form-message").allTextContents()}`);
  }
  check(true, "recording started");
  await shot(popup, "popup-recording");
  await popup.close();
  await lecture.waitForTimeout(5_000);
  const running = await badge();
  check(/^0:0[4-6]$/.test(running), `badge timer runs with the popup closed (${running})`);
  check(await lecture.evaluate(() => !document.getElementById("a").paused), "the lecture keeps playing");

  popup = await openPopup();
  check(/^0:0\d$/.test(await popup.locator("#timer").textContent()), "reopened popup shows the running recording");
  await popup.getByRole("button", { name: "Stop and save" }).click();
  await popup.locator("#record-result").filter({ hasText: "Recording saved" }).waitFor({ timeout: 30_000 });
  check(true, "stop uploads and creates the recording");
  check((await badge()) === "", "badge cleared");
  await shot(popup, "popup-saved");
  await popup.locator("#recent-list").filter({ hasText: "Enzyme kinetics, tab audio" }).waitFor({ timeout: 10_000 });
  check(true, "the new recording is listed under Recent recordings");

  // The stored audio should hold the tab's tone, not silence.
  const log = await (await fetch(`${mockOrigin}/_log`)).json();
  const stored = log.stored.at(-1);
  check(stored && stored.size > 10_000, `audio stored (${stored?.size} bytes)`);
  const audioFile = join(profile, "tab.webm");
  writeFileSync(audioFile, Buffer.from(await (await fetch(`${mockOrigin}/_object/${encodeURIComponent(stored.key)}`)).arrayBuffer()));
  const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", audioFile, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const meanVolume = Number(/mean_volume: (-?[\d.]+) dB/.exec(probe.stderr ?? "")?.[1] ?? Number.NaN);
  check(meanVolume > -40, `recording contains the tab's audio (mean ${meanVolume} dB)`);
  check(log.transcripts.length > 0, "transcription was submitted for the new recording");
  await popup.getByRole("button", { name: "Dismiss" }).click();

  // 5. Tab plus microphone (Chromium's fake microphone, allowed for the extension in the seeded profile).
  await popup.reload();
  await popup.locator("#with-mic").check();
  await popup.locator("#title").fill("Enzyme kinetics, with microphone");
  await popup.getByRole("button", { name: "Record this tab" }).click();
  await popup.locator(".recording-label").filter({ hasText: "Recording tab and microphone" }).waitFor();
  check(true, "microphone joined the tab audio");
  await popup.waitForTimeout(3_000);
  await popup.getByRole("button", { name: "Stop and save" }).click();
  await popup.locator("#record-result").filter({ hasText: "Recording saved" }).waitFor({ timeout: 30_000 });
  check(true, "tab plus microphone recording saved");

  // 6. Discard leaves nothing behind.
  await popup.getByRole("button", { name: "Dismiss" }).click();
  await popup.locator("#with-mic").uncheck();
  await popup.getByRole("button", { name: "Record this tab" }).click();
  await popup.locator("#timer").waitFor();
  const storedBefore = (await (await fetch(`${mockOrigin}/_log`)).json()).stored.length;
  await popup.getByRole("button", { name: "Discard" }).click();
  await popup.getByRole("button", { name: "Discard recording?" }).click();
  await popup.getByRole("button", { name: "Record this tab" }).waitFor();
  check((await (await fetch(`${mockOrigin}/_log`)).json()).stored.length === storedBefore && (await badge()) === "", "discard uploads nothing and clears the badge");

  // 7. Options page.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  check((await options.locator("#origin").inputValue()) === appOrigin, "settings show the configured site");
  await options.locator("#origin").fill("http://example.com");
  await options.getByRole("button", { name: "Save" }).click();
  await options.locator("#origin-status").filter({ hasText: "https://" }).waitFor();
  check(true, "settings refuse a plain-HTTP remote address");
  await options.locator("#origin").fill(appOrigin);
  await options.getByRole("button", { name: "Save" }).click();
  await options.locator("#origin-status").filter({ hasText: `Signed in as ${email}` }).waitFor();
  check(true, "settings confirm the connection");
  await shot(options, "options");
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
