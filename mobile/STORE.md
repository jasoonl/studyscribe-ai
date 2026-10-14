# Store listing, privacy answers and review notes

What to enter in App Store Connect and Google Play Console for StudyScribe. Keep it in step with `client/src/pages/Privacy.tsx` and `app.config.ts` (`ios.privacyManifests`).

## Payments decision (iOS and Android)

**The app sells nothing and does not point to a purchase.** No prices, no plan comparison, no upgrade or "subscribe" buttons, no links to checkout or the billing portal. Settings has a read-only "Plan and usage" screen (plan name, this month's minutes and AI generations, reset date) with the neutral line "Plan changes aren't available in the app." The web's billing (Stripe) is unchanged.

Why:
- **Apple, guideline 3.1.3(f) "Free Stand-alone Apps":** free apps acting as a stand-alone companion to a paid web-based tool do not need in-app purchase, provided there is no purchasing inside the app or calls to action for purchase outside of it. StudyScribe is free to download, everything works on the free plan, and paid plans are bought on the web. The guideline's examples (VoIP, cloud storage, email, web hosting) are examples, but reviewers have read the list narrowly at times, so the review notes below explain the fit. A reader-app entitlement (3.1.3(a)) does not apply: StudyScribe is not a reader app.
- **US storefront:** since the 2025 court order Apple allows external purchase links in US apps, but that does not hold in every storefront and is still changing. One global build with no purchase path is the simplest compliant option.
- **Google Play, Payments policy:** apps that sell digital features must use Play Billing (or an approved alternative billing / external offers programme in some regions). An app that shows account status but offers no way to buy in the app and no steering to buy elsewhere is allowed. Same build, same screen.
- **If in-app purchase is wanted later** (mobile-plan §7): add RevenueCat with App Store and Play products mapped to the same plans, write to the `subscriptions` table from its webhook, and only then show prices in the app.

Sources: [Apple guideline 3.1.3(f) wording, July 2026 summary](https://www.iclarified.com/77531/apple-updates-app-store-review-guidelines-allows-streaming-games-if-each-title-is-submitted-for-review), [developer forum thread on 3.1.3(f)](https://developer.apple.com/forums/thread/781935), [payments other than in-app purchase](https://webtoapp.design/blog/payments-other-than-in-app-purchase). Check the live guidelines (developer.apple.com/app-store/review/guidelines/) before each submission.

## App Store Connect

- **Name:** StudyScribe. **Subtitle:** Lecture recorder and study notes.
- **Category:** Education (secondary: Productivity). **Age rating:** 13+ questionnaire: no objectionable content; user-generated content limited to recordings people share by link or email (reporting via the support email).
- **Support URL:** `https://<domain>/help`. **Privacy policy URL:** `https://<domain>/privacy`. **Marketing URL:** `https://<domain>/`.
- **Sign-in required:** yes. Give review a demo account with recordings already transcribed: run `scripts/demo-video/v2/seed-library.mjs` against a copy, or create `appreview@…` with an invite and record a short clip. Put the email and password in "App Review Information".
- **Review notes (paste):**
  > StudyScribe records lectures and meetings the user chooses to capture and transcribes them. Recording continues with the screen locked until the user taps Stop, which is why the app uses the audio background mode; a red indicator and the system microphone indicator show while it runs. Sign in with Apple is offered next to Google. Accounts can be deleted in Settings > Delete account. The app is a free companion to our web service (guideline 3.1.3(f)): there are no purchases or purchase links in the app; paid plans are managed on our website only. Demo login: …
- **Capabilities used:** Sign in with Apple, Push Notifications, Associated Domains, Background Modes (Audio; Remote notifications).
- **Encryption:** uses only standard HTTPS (`ITSAppUsesNonExemptEncryption = false`).

### App Privacy ("nutrition label")

Data used to track you: **none**. Data linked to you (all for App Functionality, none for advertising or tracking):

| Category | Type | Notes |
|---|---|---|
| Contact Info | Email address, Name | Account |
| User Content | Audio data, Other user content | Recordings, transcripts, notes, flashcards, chats |
| Identifiers | User ID, Device ID | Account id; push token |
| Usage Data | none | No analytics in the app |
| Diagnostics | none | No crash reporting yet (add Sentry later and update this) |

The privacy manifest (`PrivacyInfo.xcprivacy`, generated from `app.config.ts`) declares the same collected types and the required-reason APIs used by the Expo modules (UserDefaults CA92.1, file timestamps C617.1/0A2A.1/3B52.1, system boot time 35F9.1, disk space E174.1/85F4.1).

## Google Play Console

- **App category:** Education. **Contact email:** the support address in `shared/legal.ts`.
- **Permissions declarations:**
  - `RECORD_AUDIO`: recording lectures and meetings the user starts.
  - `FOREGROUND_SERVICE_MICROPHONE`: the foreground service declaration form: "Records a lecture or meeting the user started, with the screen off, until the user stops it. An ongoing notification shows while recording." Attach a short video of starting a recording, locking the phone and stopping from the notification.
  - `FOREGROUND_SERVICE_MEDIA_PLAYBACK`: playing a recording with the screen off, with media controls.
  - `POST_NOTIFICATIONS`: transcript ready and reminder notifications.
- **Data safety form** (mirrors the Apple label): collected and shared only with service providers: email, name, user IDs, audio recordings, other user-generated content (transcripts, notes), device IDs (push token). Encrypted in transit: yes. Users can request deletion: yes, in the app (Settings > Delete account) and by email. Not used for advertising, no data sold.
- **Account deletion URL** (Play requires one reachable outside the app): `https://<domain>/privacy#deleting-your-data` or the Settings page on the web.
- **Testing track:** new personal developer accounts need a closed test with at least 12 testers for 14 days before production.
- **Target audience:** 13+; not designed for children.

## Screenshots

`mobile/screenshots/` has 390x844 captures from the browser check. Store screenshots must come from device builds at the required sizes (6.9" and 6.5" iPhone; 13" iPad if tablets stay enabled; Android phone and 7"/10" tablet); use a simulator or a phone with the demo account.
