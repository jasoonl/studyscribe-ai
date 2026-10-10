# StudyScribe AI — Mobile App Plan (iOS + Android)

_Last updated: 2026-10-10._

**Goal:** a native iOS and Android app that does everything the web app does, the same way, against the **same backend and database**, with the same look. The web app stays as it is. Then publish to the App Store and Google Play.

---

## 1. Recommendation: Expo (React Native) app in this repo, talking to the existing tRPC API

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Expo / React Native** | Native recording that keeps going with the screen locked, native push, native share sheet; same TypeScript/React skills; **imports the server's `AppRouter` type**, so every existing procedure is available fully typed; one codebase for iOS + Android; EAS builds and submits to both stores from the cloud (no Mac required to build) | UI has to be rebuilt with native components (no DOM) | **Recommended** |
| Capacitor (wrap the existing SPA) | Fastest; pixel-identical | `MediaRecorder` in a WebView stops when the phone locks, so a 1-hour lecture fails; App Store guideline 4.2 rejects apps that are "just a website"; cookie auth inside WebViews is fragile | Not recommended as the main app |
| Swift + Kotlin | Best native feel | Two codebases, no type sharing with the server | Too costly |

The design stays the same by porting the design tokens (colors, radius, Geist font) into **NativeWind** (Tailwind for React Native), so class names like `bg-primary rounded-xl border border-border` mean the same thing in the app as on the web, and by building a small set of primitives that match our shadcn components (Button, Card, Input, Tabs, Badge, Dialog/Sheet, Toast).

---

## 2. Feature parity checklist

Every row must work in the app before the 1.0 store release. "Server change" means a backend change needed so the app can do it; everything else reuses existing procedures unchanged.

| Web feature | Mobile implementation | Server change |
|---|---|---|
| Email/password login, signup with invite code, forgot/reset password | Native screens calling the same `/api/auth/*` endpoints | **Token auth** (see §4.1) |
| Google sign-in | `expo-auth-session` / native Google Sign-In → send ID token to server | New `/api/auth/google/native` that verifies the ID token and keeps the "existing accounts only on login" rule |
| **Sign in with Apple** | `expo-apple-authentication` | New `/api/auth/apple/native`; **required by App Store guideline 4.8** because we offer Google sign-in |
| Request access (invite request) | Native form → `requestInvite` | — |
| Dashboard (recordings list, statuses, Trash) | `FlatList` + pull-to-refresh, same cards | — |
| Record (mic) with consent notice | `expo-audio` recorder, **continues in background / screen locked**, pause/resume, level meter, interruption handling (phone calls) | — |
| Upload a file (incl. video up to 1GB, multipart >50MB) | `expo-document-picker` + photo/video library; upload via same presigned flow | Confirm `/api/storage/upload-presigned` works with a bearer token (§4.2) |
| Import from link (incl. YouTube) | Text field + **iOS/Android share extension** ("Share to StudyScribe" from Safari/YouTube) | — |
| Language picker | Same list from `shared/languages.ts` | — |
| Processing status | Poll `recordings.getStatus` every 3s while visible (same rule as the web); push notification when done | Push to device tokens (§4.3) |
| Recording detail: transcript with speakers, tap-to-seek, playback speed | `expo-audio` player with lock-screen controls, segment list | Storage proxy must accept the bearer token for audio range requests (§4.2) |
| Edit transcript | Inline edit sheet → `transcription.update` | — |
| Study notes, flashcards (Learn/Test, spaced review), quizzes, study guides, email drafts, AI tutor chat | Native screens, swipeable flashcards, haptics | — |
| Knowledge Base search | Search screen | — |
| Sharing: public link, share with user, Shared With Me | Native share sheet for the public link | — |
| Notifications (in-app list, unread count) | Same procedures; badge count on app icon | — |
| Analytics | Charts with `victory-native` or `react-native-gifted-charts`, same palette | — |
| Settings, data export, **delete account** | Same procedures; account deletion **must be reachable in-app** (Apple 5.1.1(v)) — we already have `deleteAccount` | — |
| Admin pages | **Out of scope for the app**; admins keep using the web | — |
| Demo, Pricing, Terms, Privacy, Help | Help/Terms/Privacy open in an in-app browser; Pricing see §7 | — |

New features from `competitive-feature-roadmap.md` (live transcription, Live Companion, courses, bookmarks…) ship to web first, then to the app, through the same procedures.

---

## 3. Repository layout

```
studyscribe-ai/
  client/            # web (unchanged)
  server/            # API (small additions only, see §4)
  shared/            # constants/types used by web, server AND mobile
  mobile/            # NEW — Expo app, its own package.json
    app/             # expo-router screens (file-based routing)
      (auth)/login.tsx, signup.tsx, forgot-password.tsx
      (tabs)/index.tsx (Dashboard), record.tsx, knowledge.tsx, settings.tsx
      recording/[id].tsx, recording/[id]/quiz.tsx, ...
    components/      # Button, Card, Tabs, ... (match shadcn look)
    lib/trpc.ts      # tRPC client + bearer token link
    lib/auth.ts      # secure-store token handling
    lib/upload.ts    # presigned/multipart upload
    tailwind.config.js  # tokens copied from client/src/index.css
    app.config.ts    # bundle ids, permissions, plugins
    eas.json         # build/submit profiles
```

- `mobile/` has its **own** `package.json` and lockfile so the Vercel build (`npm install` at the root, `npm run build`) is not affected. Add `mobile` to the root `tsconfig.json` `exclude` and to `.vercelignore`.
- The app imports `import type { AppRouter } from "../server/routers"` (type-only, nothing from the server is bundled) and `@shared/*` via a Metro/TS path alias.
- Keep `superjson` as the tRPC transformer, as on the web (`client/src/main.tsx`).

---

## 4. Backend changes (small, additive, web unaffected)

### 4.1 Bearer-token sessions
Today `createContext` (`server/_core/context.ts`) reads only the session cookie. Native apps should use a token kept in the device keychain instead.
- `getSessionFromCookie` → add `getSessionFromRequest(req)` that checks `Authorization: Bearer <token>` first, then the cookie. Same JWT, same `JWT_SECRET`, same expiry.
- Login/signup/Google/Apple endpoints: when the request has `X-Client: mobile`, return `{ token, user }` in the body in addition to (not instead of) setting the cookie.
- Store the token with `expo-secure-store`. Logout clears it.
- CSRF: bearer tokens are not sent automatically by browsers, so this does not weaken the web's cookie protections.
- Tests: extend `server/auth.logout.test.ts` / add `server/bearerSession.test.ts`.

### 4.2 Uploads and audio from the app
- The presigned upload endpoints and `server/_core/storageProxy.ts` must accept the bearer token. Audio playback in `expo-audio` can't attach headers on every platform, so the storage proxy also accepts a **short-lived signed playback URL** (reuse the HMAC approach in `server/transcriptionAudioLink.ts`) issued by a new `recordings.playbackUrl` procedure.
- `@vercel/blob/client` upload works over `fetch` in React Native; verify multipart (`uploadPresigned`) with a 500MB file on a real device early (Phase 1 spike). If it fails, fall back to signed PUTs of parts through the same `/api/storage/upload-presigned` token.

### 4.3 Native push notifications
- New table `deviceTokens` (id, userId, platform enum('ios','android'), token varchar(255) unique, createdAt `DEFAULT CURRENT_TIMESTAMP`, lastSeenAt).
- `devices.register` / `devices.unregister` procedures.
- `server/pushNotifications.ts`: when sending (transcription complete, AI generation done, flashcard review due), send Web Push **and** Expo push (`https://exp.host/--/api/v2/push/send`, or APNs/FCM directly later). New env var `EXPO_ACCESS_TOKEN` (optional; fail gracefully like VAPID).

### 4.4 Native Google & Apple sign-in
- `/api/auth/google/native`: verify the Google ID token (`google-auth-library`) for the iOS/Android client IDs (new env `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`); reuse `loginWithGoogleExistingOnly` / signup logic.
- `/api/auth/apple/native`: verify Apple identity token against Apple's JWKS; new `users.appleSub` column; same invite rules on signup.

### 4.5 Deep links
- `https://<app-domain>/shared/:token` and `/recording/:id` open in the app when installed: host `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from `client/public/.well-known/`. Password-reset links too.

### 4.6 Minimum app version
- `appSettings` key `minMobileVersion`; app checks on launch and shows "Please update" if older — lets us change APIs safely later.

---

## 5. Build phases

### Phase 0 — Accounts & setup (week 1)
- [ ] Apple Developer Program ($99/yr) and Google Play Console ($25 one-time) accounts in the owner's name.
- [ ] Expo account; `npx create-expo-app mobile` with expo-router + TypeScript; NativeWind; Geist font.
- [ ] Bundle ids, e.g. `ai.studyscribe.app` (iOS) / `ai.studyscribe.app` (Android). App icon + splash from the existing logo.
- [ ] Spike: record 60 min with the screen locked on a real iPhone and Android phone; upload a 500MB file. These are the two riskiest parts — prove them first.

### Phase 1 — Foundation (weeks 2–3)
- [ ] §4.1 bearer sessions (server) + login/signup/forgot-password screens.
- [ ] tRPC client with auth header, React Query, error toasts.
- [ ] Design primitives matching the web (Button, Card, Input, Tabs, Badge, Sheet, Toast, Skeleton).
- [ ] Tab bar: Dashboard · Record · Knowledge · Settings.

### Phase 2 — Core loop (weeks 4–6)
- [ ] Dashboard list + Trash.
- [ ] Record (background, pause/resume, consent notice) → upload → processing polling.
- [ ] File/video upload, link import, share extension.
- [ ] Recording detail: player with lock-screen controls, transcript, edit, language, retry.
- [ ] §4.2 playback URLs, §4.3 push.

### Phase 3 — Study tools (weeks 7–9)
- [ ] Study notes, flashcards (Learn/Test, review), quizzes, study guides, email drafts, AI tutor chat.
- [ ] Knowledge Base, sharing (native share sheet), Shared With Me, notifications, analytics, export/delete account.
- [ ] Google + Apple sign-in (§4.4), deep links (§4.5).

### Phase 4 — Hardening (weeks 10–11)
- [ ] Offline handling: queue a finished recording locally and upload when back online (never lose a lecture).
- [ ] Accessibility (Dynamic Type, VoiceOver/TalkBack labels), dark mode, tablets.
- [ ] Crash reporting (Sentry for React Native), analytics events.
- [ ] Tests: Jest + React Native Testing Library for components; Maestro flows for login → record → transcript.
- [ ] Internal testing: TestFlight (iOS) and Play Internal testing track.

### Phase 5 — Publish (week 12)
See §6.

---

## 6. Publishing checklist

### Both stores
- [ ] Privacy policy URL (existing `/privacy` — update it to mention the mobile app, microphone, push tokens, and that audio goes to AssemblyAI and text to the LLM provider).
- [ ] Support URL (`/help`) and contact email.
- [ ] **Demo account for reviewers** — signup is invite-gated, so give review teams a pre-made login with a sample recording already transcribed. Without this the app will be rejected.
- [ ] Screenshots (6.7" and 6.5" iPhone, 13" iPad if tablets supported; Android phone + 7"/10" tablet), short + long description, keywords, feature graphic (Android).
- [ ] Age rating questionnaires; content: user-generated (shared recordings) → include a report/block mechanism or limit sharing to people you invited.

### Apple App Store
- [ ] `NSMicrophoneUsageDescription`: "StudyScribe records lectures and meetings you choose to capture so they can be transcribed."
- [ ] `UIBackgroundModes: audio` (needed for locked-screen recording; justify in review notes).
- [ ] Sign in with Apple (4.8), in-app account deletion (5.1.1(v)) — both covered above.
- [ ] App Privacy "nutrition label": audio data, user content, email, identifiers — linked to user, not used for tracking.
- [ ] Recording-consent wording visible before first recording (we already have `RecordingConsentNotice`).
- [ ] Build & submit: `eas build -p ios --profile production` → `eas submit -p ios` → TestFlight → App Review.

### Google Play
- [ ] `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS` permissions; foreground-service declaration form in Play Console.
- [ ] Data safety form (mirrors the Apple label).
- [ ] New personal developer accounts must run a **closed test with at least 12 testers for 14 days** before production access — plan for this in the timeline.
- [ ] `eas build -p android --profile production` (AAB) → `eas submit -p android` → internal → closed → production.

### Updates after launch
- JS/UI-only fixes: `eas update` (over-the-air) without store review.
- Native changes (new permissions, SDK upgrades): new store build.
- Server stays backward-compatible with the oldest supported app version (§4.6).

---

## 7. Payments (decide before adding paid plans)
If StudyScribe sells subscriptions, Apple and Google require **in-app purchase** for digital features bought inside the app. Plan: RevenueCat SDK in the app + Stripe on the web, both writing to the same `subscriptions` table (from roadmap item F2) via webhooks, so a plan bought on either side unlocks both. Until billing exists, the app ships free with the same invite gating as the web, and the Pricing screen is hidden in the app (showing web prices with an outside purchase link can get the app rejected, depending on region rules).

---

## 8. Costs (approximate)
| Item | Cost |
|---|---|
| Apple Developer Program | $99 / year |
| Google Play Console | $25 one-time |
| Expo EAS | Free tier is enough to start (limited build queue); Production plan if builds become frequent |
| Push | Expo push service is free |
| Backend | Unchanged (Vercel, TiDB, Blob, AssemblyAI, OpenAI) — note Blob is on the 1GB Hobby limit, which mobile users will hit faster; plan the storage upgrade alongside launch |

## 9. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Recording stops when the phone locks or a call comes in | Phase 0 spike; background audio mode; auto-save partial file on interruption and offer to resume |
| Large uploads on mobile data fail midway | Multipart with per-part retry; "upload on Wi-Fi only" setting; local queue |
| Store rejection (invite-only, minimum functionality, missing Apple sign-in) | Reviewer demo account, native features (background recording, share extension, push), Sign in with Apple |
| Blob store hits 1GB and suspends uploads for everyone | Upgrade storage plan before launch; Admin page already shows usage |
| API changes break old app versions | Additive-only API changes, `minMobileVersion` gate |

## 10. First concrete steps
1. Create the Apple and Google developer accounts (only the owner can do this).
2. Add bearer-token sessions to the server (§4.1) — small, safe, and it unblocks everything else.
3. Scaffold `mobile/` with Expo + NativeWind + tRPC and get login → Dashboard list working against production.
4. Run the background-recording and 500MB-upload spikes on real devices.
