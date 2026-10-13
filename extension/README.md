# StudyScribe for Chrome (roadmap E6)

A Manifest V3 extension with two actions on the tab you are looking at:

- **Import this page** sends the tab's address to `recordings.createFromUrl`, the same import as "Import from a link" on the site (YouTube, direct media links, and pages that publish a media file; the server makes every decision, including its SSRF checks).
- **Record this tab** records the tab's audio, and your microphone if you tick "Include my microphone", until you press **Stop and save**. The tab stays audible while it is captured. Recording runs in an offscreen document, so it carries on with the popup closed; the toolbar badge shows the elapsed time. The file is uploaded through the site's own upload endpoints and saved with `recordings.create`, then transcribed like any recording.

The popup also shows who is signed in and the five newest recordings. Plain TypeScript and DOM, bundled with esbuild; no framework.

## How it talks to StudyScribe

Exactly as the web client does, with no server changes:

| What | Endpoint |
| --- | --- |
| Signed-in check | `GET /api/auth/me` (401 means signed out) |
| Recent recordings | `GET /api/trpc/recordings.list` |
| Import | `POST /api/trpc/recordings.createFromUrl` with `{ json: { url, audience, title?, language? } }` (superjson envelope) |
| Upload | `POST /api/storage/upload-url`, then a PUT to the presigned Blob URL, or the Blob SDK's multipart upload through `/api/storage/upload-presigned` above 50MB, or inline base64 when the server answers 409 (no Blob store) |
| Save | `POST /api/trpc/recordings.create` with `audioUpload` (or `audioBase64`), `title`, `duration`, `language?` |

**Authentication is the site's own `studyscribe_session` cookie**, which is `SameSite=Lax`. A request from `chrome-extension://…` would normally be cross-site, and Lax cookies are not sent on cross-site `fetch`. Chrome makes an exception: a request from an extension to a host it holds host permission for is treated as same-site, so the cookie is attached when the request uses `credentials: "include"`. That is why the manifest asks for the StudyScribe origin as a host permission, and why every request in `src/lib/api.ts` uses `credentials: "include"`. The Blob SDK's uploader fetches its token without credentials, so `withSiteCredentials` (`src/lib/upload.ts`) adds them for the StudyScribe origin only, while recording uploads run. The server has no CORS or Origin check, and host permission also exempts the extension from CORS, so nothing on the server had to change. This was verified in Chromium with the unpacked extension (see the end-to-end test): the cookie is reported as `SameSite=Lax` and the popup is signed in.

The extension never sees a password or token and stores none. Signing out on the site signs the extension out.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | The current tab's address and title, only after you open the extension on it. |
| `tabCapture` | Record that tab's audio. |
| `offscreen` | Keep the recorder running while the popup is closed. |
| `storage` | The site address, the recorder's state, and your last language and microphone choice. |
| Host: `https://studyscribe-ai.vercel.app/*` | Use your StudyScribe session (see above). |
| Optional hosts: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Requested one at a time, only when you set a different site address in Settings. |

No content scripts, no `tabs`, no `<all_urls>`, no `externally_connectable`, no remote code.

The microphone is used only when "Include my microphone" is ticked. Offscreen documents cannot show Chrome's permission prompt, so the first time, the extension opens a small page (`permission.html`, also reachable from Settings) where you allow it once.

## Build

```bash
cd extension
npm install
npm run build        # dist/ (load unpacked) + release/studyscribe-extension-<version>.zip
npm run check        # tsc
npm test             # vitest: origin checks, message passing, worker state, upload planning, tRPC encoding
```

`npm run build:dev` (or `node scripts/build.mjs --dev-origin=http://localhost:3107`) builds a development copy named "StudyScribe AI (development)" that defaults to, and has host permission for, a local server. `npm run icons` regenerates `static/icons/` from `client/public/favicon.ico` and `logo.webp`.

The extension is its own package: it is not part of the root `tsconfig.json`, Vitest config or build, so root `npm run check`, `npm test` and `npm run build` ignore it. It imports one file from the app, `shared/languages.ts`, for the language list.

## Load it

1. `npm run build`
2. Chrome > `chrome://extensions` > turn on Developer mode > **Load unpacked** > choose `extension/dist`.
3. Pin StudyScribe in the toolbar, sign in on the site, and open the extension on a tab.

To use another StudyScribe server, open the extension's **Settings** (gear in the popup) and enter its address. HTTPS is required except for `localhost`/`127.0.0.1`; Chrome asks you to allow the new site.

## End-to-end test

`e2e/extension.e2e.mjs` loads the unpacked development build in Chromium with Playwright and checks sign-in detection, the import call, tab recording (audio level of the stored file measured with ffmpeg), tab plus microphone, discard, and Settings. It needs a local app, a scratch database and the mocks in `e2e/mock-services.mjs` (storage, AssemblyAI submission and a page playing a tone):

```bash
service mariadb start
mysql -uroot -e "CREATE DATABASE ss_ext; CREATE USER 'ssext'@'127.0.0.1' IDENTIFIED BY 'ssext'; GRANT ALL ON ss_ext.* TO 'ssext'@'127.0.0.1';"
DATABASE_URL=mysql://ssext:ssext@127.0.0.1:3306/ss_ext npm run db:migrate          # from the repo root
# create a user (bcrypt hash of the password) in ss_ext.users, then:
node extension/e2e/mock-services.mjs 7090 &
DATABASE_URL=mysql://ssext:ssext@127.0.0.1:3306/ss_ext JWT_SECRET=dev PORT=3107 \
  BUILT_IN_FORGE_API_URL=http://127.0.0.1:7090 BUILT_IN_FORGE_API_KEY=dev \
  ASSEMBLYAI_API_KEY=dev MOCK_ASSEMBLYAI_URL=http://127.0.0.1:7090/assemblyai \
  NODE_OPTIONS="--import ./scripts/dev/redirect-assemblyai.mjs" npm run dev &
cd extension && npm run build:dev
E2E_EMAIL=you@example.com E2E_PASSWORD=... xvfb-run -a node e2e/extension.e2e.mjs
```

`E2E_SCREENSHOTS=<dir>` saves screenshots of each popup state. `CHROMIUM_PATH` points at a Chromium build (branded Google Chrome no longer accepts `--load-extension`). Notes on what the test has to work around: automation cannot click the toolbar icon, so it opens `popup.html?tab=<id>` for the lecture tab and starts Chromium with `--allowlisted-extension-id` (what the toolbar click grants through `activeTab`); it cannot answer a permission prompt, so the profile starts with the microphone allowed for the extension; and `--use-fake-ui-for-media-stream` is not used because it makes tab capture in an offscreen document fail with "Requested device not found". The import is checked against the server's real answer for a local page ("That link points to a private address."), since the server refuses private addresses by design.

## Publish to the Chrome Web Store

1. Bump `version` in `extension/package.json` (the manifest takes it from there) and run `npm run build`.
2. In the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time US$5 registration), create an item and upload `release/studyscribe-extension-<version>.zip`.
3. Store listing: copy the text from `STORE_LISTING.md`; upload the 128px icon (`static/icons/icon-128.png`), at least one 1280x800 screenshot (the e2e screenshots are a starting point), and a 440x280 promo tile.
4. Privacy practices: the single purpose and permission justifications are in `STORE_LISTING.md`; the data disclosure is "Website content" (the page address, sent on request) and "Audio" (recordings, sent on request), not sold or used for anything else. Privacy policy URL: `https://studyscribe-ai.vercel.app/privacy`, and `PRIVACY.md` here describes the extension.
5. Submit for review. `tabCapture` and the microphone usually mean a manual review of a few days.

Later updates: bump the version, rebuild, upload the new zip to the same item.
