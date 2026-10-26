# StudyScribe desktop (roadmap E7)

An Electron shell around the production web app (`https://studyscribe-ai.vercel.app` by default). It adds what a browser tab cannot do and nothing else; every screen is the web app itself, so new web features appear in the desktop app without a release.

- **System audio.** The record page's existing "Record a tab or screen audio too" / "Add tab or screen audio" (A3) calls `getDisplayMedia`. In the desktop app the main process answers that call (`setDisplayMediaRequestHandler`): it asks once ("Record your computer's audio?"), then hands back a screen source with `audio: "loopback"`. The web app stops the video track at once and mixes the system audio with the microphone as it does in Chrome. No web change was needed: Electron reports the Chromium brand, so `canCaptureTabAudio()` is true.
  - **Windows:** WASAPI loopback, everything the computer plays.
  - **macOS:** system audio comes from ScreenCaptureKit, which needs macOS 13 or later and the **Screen Recording** permission for StudyScribe (System Settings > Privacy & Security > Screen & System Audio Recording); macOS asks on first use and the app must be restarted after granting it. On macOS 15+ the handler sets `useSystemPicker`, so the system's own share picker appears. This path was not run on a Mac here; test it on real hardware before a release (see Limitations).
  - **Linux:** Chromium's PulseAudio/PipeWire monitor of the default output. Verified under Xvfb: the share returns an "Entire screen" video track and a "System audio" track.
- **Study help window.** View > Study Help Window (Ctrl/Cmd+Shift+H), or `window.studyscribeDesktop.setStudyHelp(true)` from the page, turns the window into a 420x680 panel in the top-right corner of the screen, always on top and visible over full-screen apps, showing the record page (live transcript, Study help buttons, Captions). It is the same page, not a second window: the recorder and live transcript live in the page, so a separate window would not see the recording. The page is not reloaded (navigation uses `history.pushState`), so a recording in progress carries on. Toggling it off restores the previous size and position. No web route was added.
- **Google sign-in in your own browser.** "Continue with Google" opens in Chrome (or the default browser when Chrome is missing, or with `"signInBrowser": "default"` in `settings.json`), where the person's Google accounts are already signed in. The browser then opens `studyscribe://signed-in?code=…` and the app finishes the sign-in itself (`server/desktopAuth.ts`): the code is signed, expires after five minutes, and only works with a verifier that never leaves the app, so the browser itself is not signed in and nothing else that catches the link can use it. The window title stays "StudyScribe AI" instead of following each page's title.
- **studyscribe:// links.** `studyscribe://recording/12`, `studyscribe://record`, `studyscribe://dashboard`. Only plain app paths are accepted (no `/api`, no encoded slashes, a short query string at most), and they navigate inside the running app without reloading it.

## Security defaults

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every window (`app.enableSandbox()`), `webSecurity` on, no `<webview>`.
- The window can only show the configured origin, plus Google's sign-in page (`accounts.google.com`, for "Continue with Google"). Any other navigation or redirect is stopped and opened in the default browser (`https:`, `http:` and `mailto:` only; never `file:` or other schemes). `window.open` and `target="_blank"` always go to the browser; the app keeps one window.
- Permissions are granted only to the app's origin and only these: microphone (audio only, never the camera), display capture, notifications, clipboard write, fullscreen.
- The preload bridge exposes named functions (`getInfo`, `setStudyHelp`, `onStudyHelpChange`, `retry`, plus `isDesktop`, `platform`, `systemAudio`), never `ipcRenderer`; the main process checks that each call comes from the app's origin.
- Leaving the page during a recording (reload, close) asks first with a native dialog, because the web app's `beforeunload` would otherwise be refused silently by Electron.
- If the site cannot be reached, a local page explains it and offers "Try again".
- Single instance: opening the app again focuses the running one.

## Configuration

The site address, first match wins: `--url=<origin>` on the command line, the `STUDYSCRIBE_URL` environment variable, `{"origin": "…"}` in `settings.json` in the app's data folder (`~/Library/Application Support/StudyScribe`, `%APPDATA%\StudyScribe`, `~/.config/StudyScribe`), then production. HTTPS is required except for `localhost`/`127.0.0.1`.

**Updates** use `electron-updater` but are off: the app checks only when packaged and `STUDYSCRIBE_UPDATE_URL` points at a generic release feed (the folder electron-builder writes `latest.yml`/`latest-mac.yml` to). To turn them on for real, host the release files, set that URL at build time or replace it with a `publish` block (for example GitHub Releases) in `electron-builder.yml`, and sign the builds (updates on macOS require a signed app).

## Build and run

```bash
cd desktop
npm install            # downloads Electron for this platform
npm start              # bundles src/ with esbuild into dist/ and opens the app on production
npx electron . --url=http://localhost:3000   # against a local server (after npm run build)
npm run check          # tsc
npm test               # vitest: origin, navigation lock, deep links, permissions, Study help bounds, system audio
```

As root (containers and CI), Chromium refuses to start without `--no-sandbox`; the app honours that switch and otherwise always sandboxes.

`npm run dist:linux`, `npm run dist:mac`, `npm run dist:win` package with electron-builder into `release/` (ignored by git): an AppImage, a universal DMG, and an NSIS installer for x64 and arm64. Each target is built on its own OS (macOS for the DMG; Windows, or Linux with Wine, for NSIS). The icon is `build/icon.png` (1024px, regenerated by `python3 scripts/make-icon.py` from the large logo in `scripts/demo-video/v2/assets/`).

The desktop app is its own package; root `npm run check`, `npm test` and `npm run build` do not include it.

## End-to-end test

`e2e/desktop.e2e.mjs` drives the app with Playwright's Electron support against a local server: it checks the configured origin loads, the bridge and secure `webPreferences`, the navigation lock and external links, sign-in, that the record page offers tab or screen audio, that `getDisplayMedia` returns a screen and system audio track, that a recording with system audio starts, the Study help window (compact, always on top, same page, recording still running), deep links, and the leave-during-recording prompt.

```bash
# a local app on :3107 as in extension/README.md, then:
cd desktop && npm run build
E2E_EMAIL=you@example.com E2E_PASSWORD=... xvfb-run -a -s "-screen 0 1920x1080x24" node e2e/desktop.e2e.mjs
```

`E2E_LIVE=1` (with `scripts/dev/mock-live-services.mjs` running and the app started with `ASSEMBLYAI_STREAMING_HOST=http://127.0.0.1:7071 OPENAI_API_KEY=dev OPENAI_BASE_URL=http://127.0.0.1:7071/v1`) also checks that the compact window shows the live transcript and Study help. `E2E_EXECUTABLE=release/linux-unpacked/studyscribe` runs the same checks against a packaged build. `E2E_SCREENSHOTS=<dir>` saves screenshots.

## Signing and publishing

**macOS** (needed for Gatekeeper, the microphone and Screen Recording prompts to name the app, and updates):

1. Join the Apple Developer Program and create a "Developer ID Application" certificate; install it in the build Mac's keychain (or export it as a .p12 and set `CSC_LINK` and `CSC_KEY_PASSWORD`).
2. Create an app-specific password for the Apple ID and note the Team ID.
3. In `electron-builder.yml` set `mac.notarize: true`, then build with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` set: `npm run dist:mac`. electron-builder signs with the hardened runtime and the entitlements in `build/entitlements.mac.plist` (JIT, microphone, network), submits to Apple's notary service and staples the ticket.
4. Check with `spctl -a -vv "release/mac-universal/StudyScribe AI.app"` and `xcrun stapler validate "release/StudyScribe AI-<version>-universal.dmg"`.

**Windows:** without a code-signing certificate SmartScreen warns on install. Buy an OV or EV certificate (EV, or Azure Trusted Signing, builds reputation fastest), then set `CSC_LINK`/`CSC_KEY_PASSWORD` (or electron-builder's `win.azureSignOptions`) and run `npm run dist:win`.

**Linux:** the AppImage needs no signing. Make it executable and run it; `studyscribe://` links work once the desktop file is registered (AppImageLauncher or `--appimage-extract` and installing the `.desktop` file).

Publish the files from `release/` (DMG, `.exe`, AppImage, and the `latest*.yml` files if updates are on) wherever downloads are hosted, and link them from the site.

## Limitations

- macOS system audio was not exercised on a Mac in this environment (only Linux under Xvfb). Electron's loopback on macOS depends on the macOS and Electron versions; if a share comes back without an audio track, the web app records the microphone only and says so.
- The record page's helper text still says to pick a tab and "Also share tab audio", which is browser wording. A desktop-aware label could read `window.studyscribeDesktop.systemAudio`; it was left alone to keep this change out of the web app.
- Against a server without desktop sign-in (before `server/desktopAuth.ts` is deployed), "Continue with Google" falls back to Google's page inside the window, where Google may refuse some accounts ("This browser or app may not be secure").
- Stripe Checkout and other external pages open in the default browser by design, so the app picks up a new plan after a reload.
