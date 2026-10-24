# StudyScribe mobile app (iOS and Android)

An Expo (SDK 57, expo-router, TypeScript) app that does what the web app does, against the same API and database. It has its own `package.json` and lockfile; the web build and Vercel never install or build it (`mobile` is in the root `.vercelignore` and the root `tsconfig.json` excludes it).

## Layout

```
mobile/
  app.config.ts        bundle id, permissions, background audio, privacy manifest, plugins
  eas.json             EAS build and submit profiles
  src/app/             screens (expo-router): (auth)/ sign-in screens, (app)/(tabs)/ Library, Record, Ask, Tasks, Settings,
                       (app)/recording/[id]/ detail, flashcards, quiz, guide, tutor, drafts, plus courses, exam packs,
                       shared with me, trash, notifications, vocabulary, plan, delete account
  src/components/ui/   primitives matching the web's shadcn components: Button, Card, Input, Segmented (tabs), Badge, Sheet, Toast, ...
  src/lib/             authApi + session (keychain token), trpc (bearer link + superjson, typed from server/routers.ts),
                       upload (presigned PUT and Blob multipart), recorder/ (state machine, crash journal, RecorderProvider),
                       push, links (web path -> screen), config
  src/global.css, tailwind.config.js, src/theme/tokens.ts   design tokens ported from client/src/index.css
  scripts/             make-icons.py (icons/splash from the web logo), web-preview.mjs + web-e2e.mjs (browser check)
```

The app imports `AppRouter` from `../server/routers` as a type only, and runtime code from `../shared` (Metro `watchFolders`). Typechecking the app therefore needs the root `node_modules` installed too.

## Develop

```bash
npm install                    # in the repo root (types for the server) and in mobile/
cd mobile
npm run typecheck && npm test  # tsc + jest-expo unit tests
npx expo start                 # then a development build (see below); Expo Go lacks some native modules (Google sign-in)
```

`EXPO_PUBLIC_API_URL` points the app at a server (default: production). For a local server on a phone, use your computer's LAN address, for example `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start`.

### Checking it in a browser (no phone needed)

The app runs on react-native-web, which is good enough to check screens and flows (not recording in the background, push or sign in with Apple/Google):

```bash
# a local server with the demo library (see CLAUDE.md, "Local Development Setup")
DATABASE_URL=mysql://ss:ss@127.0.0.1:3306/ssmobile node scripts/demo-video/v2/seed-library.mjs
node scripts/dev/mock-phase4-services.mjs 7072 &
PORT=3100 DATABASE_URL=... JWT_SECRET=dev OPENAI_API_KEY=dev OPENAI_BASE_URL=http://127.0.0.1:7072/v1 OPENAI_MODEL=mock npx tsx server/_core/dev.ts &
cd mobile
npx expo export -p web --output-dir dist-web
API_TARGET=http://127.0.0.1:3100 PORT=8099 node scripts/web-preview.mjs &   # serves the app and proxies /api
PLAYWRIGHT_MODULE=$(npm root -g)/playwright/index.js node scripts/web-e2e.mjs http://localhost:8099 screenshots
```

`web-e2e.mjs` signs in as the demo user at 390x844 and walks every main screen, saving screenshots (`SCHEME=dark` for dark mode).

### Proving the native bundles build

```bash
npx expo export -p ios -p android --output-dir dist-native
npx expo-doctor
```

## Before the first build (owner)

1. **Accounts:** Apple Developer Program ($99/yr), Google Play Console ($25), an Expo account. `npx eas-cli@latest login`.
2. **Bundle id:** `com.studyscribe.app` is a placeholder. Register the real one in Apple Developer (Identifiers, with Sign in with Apple, Push Notifications and Associated Domains capabilities) and in Play Console, then set `APP_BUNDLE_ID` (EAS environment variable) or edit `app.config.ts`. Update `shared/mobile.ts` (`MOBILE_BUNDLE_ID`), `client/public/.well-known/*` and `APPLE_BUNDLE_IDS` on the server to match.
3. **EAS project:** `npx eas-cli@latest init` and put the project id in the `EAS_PROJECT_ID` EAS environment variable (push tokens and updates need it).
4. **Universal and app links:** in `client/public/.well-known/apple-app-site-association` replace `APPLE_TEAM_ID` with the Team ID; in `assetlinks.json` replace the fingerprint with the SHA-256 of the Play app signing key (Play Console, Test and release, App integrity). Set `APP_DOMAIN` if the site moves off `studyscribe-ai.vercel.app`.
5. **Google sign-in:** in Google Cloud Console (same project as the web client) create an iOS OAuth client and an Android OAuth client (package name + SHA-1 of the signing key). EAS environment variables for the app: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the existing web client id; Android tokens are issued for it), `GOOGLE_IOS_URL_SCHEME` (the iOS client id reversed, `com.googleusercontent.apps.…`). Server (Vercel): `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`. Without them the Google button is hidden.
6. **Sign in with Apple:** enabled by the bundle id capability; nothing else in the app. Server: `APPLE_BUNDLE_IDS` (comma separated, default `com.studyscribe.app`).
7. **Push:** iOS: `eas credentials` creates the APNs key. Android: create a Firebase project, add the Android app, upload the FCM V1 service account key with `eas credentials`. Optional server env `EXPO_ACCESS_TOKEN` if "enhanced push security" is on in the Expo project.
8. **Minimum version:** the server can force an update with `MOBILE_MIN_VERSION` (env) or the `min_mobile_version` app setting (`mobile.setMinVersion`, admin). Set `MOBILE_APP_STORE_URL` and `MOBILE_PLAY_STORE_URL` so the update screen links to the stores.
9. **Database:** run `npm run db:migrate` against production for `drizzle/0029_mobile_devices.sql` (device tokens, Apple identities). Until then push to phones and Sign in with Apple are off; everything else works.
10. **Storage:** mobile users upload more; the Blob store is on the 1GB Hobby limit (see CLAUDE.md). Upgrade before launch.

## Build and submit

```bash
eas build -p ios --profile development      # dev client for a phone (then `npx expo start --dev-client`)
eas build -p all --profile preview          # internal testing builds (Android APK, iOS ad hoc)
eas build -p ios --profile production       # App Store build
eas submit -p ios --profile production      # to App Store Connect (TestFlight), needs ascAppId/appleTeamId in eas.json
eas build -p android --profile production   # AAB
eas submit -p android --profile production  # to the Play internal track, needs google-play-service-account.json (never commit it)
eas update --channel production             # JS-only fixes without a store review
```

Store listing, privacy answers and review notes: see `STORE.md`.

## What needs a real device

Not testable in the browser or CI, check on a phone before release: recording for an hour with the screen locked and during a phone call (interruption shows as paused; resume continues the same file); the iOS recorder writing ADTS AAC to a `.aac` file (crash-safe, see `src/lib/recorder/RecorderProvider.tsx`); force-quitting mid-recording and getting the audio back on relaunch; a 500MB+ video upload over the multipart path; lock-screen playback controls; push delivery and tapping a notification; Google and Apple sign-in; universal links.

Study sources (course library, `src/lib/sources/`): the iOS document picker with iCloud Drive and Files-provider files and `.md` types; native upload task progress, and the upload continuing while the app is in the background; resuming a half-read source after a force-quit (journal in `source-uploads/`); `AppState` resume timing for the read and summarize steps; VoiceOver and the largest Dynamic Type sizes on the library and upload rows; universal links to `/sources/:id` and `/courses/:id/sources` (the `.well-known` association file needs those paths).
