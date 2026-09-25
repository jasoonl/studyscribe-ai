# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StudyScribe AI is a full-stack app: a React SPA + Express/tRPC API for recording, uploading, or importing-by-link lectures/meetings, transcribing them (AssemblyAI, with speaker diarization), and generating AI study tools (flashcards, study guides, quizzes, email drafts, an AI tutor chat) from the transcript. Auth is custom (invite-gated email/password + Google OAuth), backed by a TiDB Cloud (MySQL-compatible) database via Drizzle ORM.

It runs on Vercel as serverless functions today; the code also supports a standalone Node server (Railway/Render) and still contains legacy references to its original "Manus" hosting platform.

## Commands

```bash
npm install --include=dev --no-audit --no-fund   # Vercel's actual install command — use npm, not pnpm, despite packageManager: pnpm in package.json
                                                   # package-lock.json is committed so this is reproducible; keep it in sync with pnpm-lock.yaml
                                                   # (regenerate both — `pnpm install` then `npm install` — after any dependency/override change)
npm run dev        # tsx watch server/_core/dev.ts — Express + Vite middleware, picks first free port from 3000
npm run build       # vite build (client) + esbuild bundles server/_core/index.ts and standalone.ts to dist/
npm start          # runs the built standalone server (dist/standalone.js) — used by Railway/Render, not Vercel
npm run check      # tsc --noEmit
npm test           # vitest run
npm run format     # prettier --write .
npm run db:push    # drizzle-kit generate && drizzle-kit migrate
npm run db:migrate # drizzle-kit migrate (applies committed migrations in drizzle/ only)
```

Run a single test file: `npx vitest run server/authService.test.ts` (or any path). Filter by name: `npx vitest run -t "some test name"`.

A handful of server tests (e.g. `server/providerCredentials.test.ts`) call real services and fail locally without production secrets; that is expected, not a regression. The live AssemblyAI test (`server/speakerDiarization.provider.test.ts`) is skipped unless `RUN_PROVIDER_INTEGRATION_TESTS=true` and `ASSEMBLYAI_API_KEY` are set.

There is no lint script and no CI workflow in this repo (only `.github/dependabot.yml`).

## Architecture

### Server bootstrapping — one Express app, three entry points

`server/_core/app.ts` builds the single Express app (`createApp()`) shared by every runtime target. Three separate entry points wrap it:
- `server/_core/index.ts` — the Vercel serverless handler (`api/index.mjs` imports the built `dist/index.js` and re-exports it as the default handler). It also starts a real listener if run directly (`isDirectNodeExecution`), which is how the standalone path works.
- `server/_core/standalone.ts` — explicit standalone entry for Railway/Render (`npm start`).
- `server/_core/dev.ts` — dev server: wires in Vite's middleware (`setupVite`) for HMR, and calls `resumeProcessingRecordings()` on boot to pick back up any transcriptions that were mid-flight.

Because `app.ts` must stay importable by the Vercel function without pulling in Vite/static-serving code, don't add Vite-only imports there — put dev-only wiring in `dev.ts`.

### Routing inside the Express app

- REST routes for auth (`server/authRoutes.ts`), Google OAuth (`server/googleOAuthHandler.ts` + `server/_core/oauth.ts`), the AssemblyAI webhook (`server/transcriptionWebhook.ts`), storage proxying (`server/_core/storageProxy.ts`, registered via `registerStorageProxy`), and a gated one-time schema-init endpoint (`server/schemaInit.ts`). Auth endpoints are rate-limited (`server/_core/rateLimit.ts`, `express-rate-limit`), which depends on `app.set("trust proxy", 1)` in `server/_core/app.ts` so limits key on the real client IP behind Vercel's proxy; the tRPC `requestInvite` mutation uses `checkTrpcRateLimit` for the same reason.
- Everything else goes through tRPC at `/api/trpc`, defined in `server/routers.ts` (`appRouter`), which composes `systemRouter`, `customAuthRouter`, `notificationsRouter`, and the main routers for recordings/transcripts/study notes/flashcards/quizzes/study guides/email drafts/chat/browser push.
- tRPC procedure tiers (`server/_core/trpc.ts`): `publicProcedure`, `protectedProcedure` (requires `ctx.user`), `adminProcedure` (requires `role === 'admin'`). Auth state comes from a signed session cookie, resolved once per request in `server/_core/context.ts` (`createContext`) — there is no Manus OAuth fallback anymore, only the custom cookie session.

### Auth model

Invite-gated signup: `/api/auth/signup` requires a valid, unused, unexpired invite code tied to the signing-up email (`server/authService.ts`). Login supports email/password (bcrypt) and Google OAuth (`server/googleOAuthHandler.ts`); `loginWithGoogleExistingOnly` intentionally rejects unknown Google accounts on the login page (no silent account creation) while the signup path auto-creates. `getSafeApplicationOrigin` (`server/email.ts`) allowlists which origins the Google OAuth redirect/state and password-reset links may point to — extend `knownVercelOrigins`/`knownManusOrigins` there if the app moves to a new domain, since anything not on the allowlist silently falls back to the configured default origin.

Admin-invite-approval UI exists (`client/src/pages/AdminInviteRequests.tsx`, `AdminInviteCodes.tsx`) for admins to review `/request-access` submissions and issue codes, gated by `adminProcedure`.

### Database — TiDB Cloud via Drizzle, multiple env-var shapes

`server/db.ts` is the single source of truth for the DB connection and every query helper (no repository classes — just exported functions per entity, e.g. `getUserByEmail`, `createRecording`). `getExternalDatabaseConfig()` resolves the connection in this precedence order, because TiDB Cloud's "Connect" dialog and Vercel's own conventions have both been used historically:
1. `TIDB_HOST`/`TIDB_PORT`/`TIDB_USER` (or `TIDB_USERNAME`)/`TIDB_PASSWORD`/`TIDB_DATABASE` (or `TIDB_DB_NAME`) if *all* are present.
2. Same shape with a `DB_` prefix instead of `TIDB_`.
3. Otherwise falls back to `DATABASE_URL`.

An incomplete `TIDB_*`/`DB_*` set must not shadow a working `DATABASE_URL` — that's a real regression that happened once already (see git history around `getExternalDatabaseConfig`). `normalizeTiDbDatabaseName` redirects TiDB's protected default schemas (`sys`, `mysql`, etc.) to `test`. `drizzle.config.ts` re-implements the same precedence independently for CLI commands (`db:push`/`db:migrate`) — keep both in sync if the resolution logic changes.

Schema lives in `drizzle/schema.ts` (19 tables: users, recordings, transcripts, studyNotes, flashcards, flashcardReviews, chatHistory, tags + join tables, userNotifications, pushSubscriptions, inviteCodes, inviteRequests, passwordResetTokens, studyGuides, quizzes, quizAttempts, emailDrafts). Migrations are committed SQL files under `drizzle/*.sql`; TiDB does not support every MySQL default expression (e.g. `DEFAULT (now())` and JSON column defaults have both caused migration failures before — use `DEFAULT CURRENT_TIMESTAMP` and no JSON defaults).

### Provider abstractions (swap points if changing services)

- **Storage**: `server/storage.ts` — Vercel Blob (`isVercelBlobStorageConfigured`) is primary; falls back to legacy "Forge" (Manus's built-in storage API, `BUILT_IN_FORGE_API_URL`/`_KEY`) if Blob isn't configured. Browser uploads go directly to Blob via presigned tokens (`createDirectAudioUpload`, `client/src/lib/directAudioUpload.ts`); the per-recording caps (1GB upload, 500MB link import) live in `shared/const.ts` so the UI text and server checks share one value. The binding limit is the Blob store's total size: the project is on Vercel's Hobby plan (1GB), and a store over its limit is suspended so every upload fails. The Admin page shows usage (`diagnostics.storage`, `BLOB_STORAGE_LIMIT_BYTES` overrides the 1GB default once the plan changes). Soft-deleting a recording (Trash) keeps its audio; only `recordings.permanentDelete`/`emptyTrash` remove it (`purgeRecordings` deletes the audio first and aborts if that fails, so a file is never orphaned).
- **Transcription/diarization**: `server/speakerDiarization.ts` — AssemblyAI. Submission (`submitTranscriptionJob`) and status (`checkTranscriptionStatus`) are separate calls, and **no request may wait out a whole transcription**: Vercel functions have a 60s `maxDuration` and don't guarantee unawaited work runs after the response is sent, so a long in-request poll silently strands the recording in "processing" (this happened). Completion is instead driven one of two ways, chosen by `isAssemblyAiWebhookConfigured()` (needs `ASSEMBLYAI_WEBHOOK_SECRET` + `PUBLIC_APP_URL`, not just the API key):
  - **Webhook mode**: AssemblyAI calls back `server/transcriptionWebhook.ts`.
  - **Polling mode** (the fallback when the webhook isn't configured): the client polls `recordings.getStatus` every 3s while a recording is `processing`, and each call runs one `advancePollingTranscription` check. Every page that shows a processing recording (`Record`, `Upload`, `RecordOrUpload`, `RecordingDetail`) must keep polling, or that recording never resolves in polling mode. `finalizeCompletedTranscription`/`finalizeFailedTranscription` in `server/routers.ts` are the single completion path for both modes.
  - A job that finishes with no text (silence, music, unintelligible audio) resolves as a failure, `NO_SPEECH_ERROR`, in both modes; the provider's own "no spoken audio" language-detection error is mapped to the same message. Never let a `completed` provider status with empty text fall through to "processing" — that spins the recording forever.
  - `normalizeDiarizedSegments` splits long single-speaker turns at sentence ends and at gaps of 6s+ between words, because the provider returns one utterance per speaker turn and a lecture would otherwise be one unseekable block.
  - The admin-only `diagnostics.transcription` procedure (shown on the Admin page) reports which mode and which env vars are active. Check it first when transcripts fail: a missing `ASSEMBLYAI_API_KEY` otherwise looks like a generic failure.

  Three more pieces of this pipeline exist for non-obvious reasons and shouldn't be simplified away:
  - `server/transcriptionAudioLink.ts` issues HMAC-signed, 24h links for the provider to fetch audio from *this* server. Stored objects deliberately use a neutral `.bin` key and generic content type to satisfy storage's content-type policy, so the provider would otherwise get no format hint; storage's own signed URLs also expire before a queued job downloads.
  - `server/urlAudioImport.ts` fetches user-supplied links, so it is an SSRF surface: every hostname is DNS-resolved and rejected if it lands in private/loopback/link-local space, and redirects are followed manually (max 3) so each hop is re-checked. YouTube links are handled by `server/youtubeAudio.ts` before any of this: it asks YouTube's player endpoint (iOS client, Android VR fallback) for the audio streams, picks one (`pickAudioFormat`), requires the download host to be `googlevideo.com`, and streams it in ranged chunks. It is an unofficial endpoint, so YouTube may change it or challenge server IPs with a bot check; every failure maps to an explanatory error (`describePlayabilityFailure`). Other streaming-page hosts whose terms forbid media extraction (Vimeo, SoundCloud etc., `STREAMING_PAGE_HOSTS`) are refused with an explanatory error rather than scraped. Direct media links work, and so do ordinary web pages that publish a media file: `server/mediaPageResolver.ts` pulls candidates from Open Graph tags, `<audio>/<video>/<source>`, JSON-LD and download links, then each candidate is fetched through the same SSRF checks (one level deep only). An HTML response is never treated as audio even if the URL ends in `.mp3`, and servers' alternate content types (Wikimedia's `application/ogg`, `audio/x-mp3`, …) are normalised through `CONTENT_TYPE_ALIASES` before storage, which only accepts the canonical ones. `recordings.createFromUrl` tees the fetched stream into Blob storage and the duration probe in a single pass.
  - The webhook answers an **unknown transcript id with 503, not 204** — the provider id is written only after submission returns, so a short clip can call back first; a 204 would tell the provider delivery succeeded and permanently lose the transcript. Failed recordings recover via `recordings.retryTranscription` rather than re-upload.
- **Audio playback**: `server/_core/storageProxy.ts` serves recording audio with HTTP byte-range support — required or Safari won't play or seek at all. It also falls back to slicing the full body (206/416) if the storage backend ignores `Range`.
- **Recording duration**: `MediaRecorder` output (WebM/MP4) carries no duration header, so `<audio>.duration` can be `Infinity`/NaN, and Safari never resolves it on its own. Duration is therefore measured explicitly: `client/src/lib/probeAudioDuration.ts` for uploads/recordings, `server/audioDuration.ts` (`music-metadata`) for link imports, and `AudioPlayer` resolves streamed-length audio itself. `duration` of `0` means "unknown" and `formatRecordingDuration` (`client/src/lib/formatDuration.ts`) renders it as "Unknown" — always use that helper rather than formatting minutes inline.
- **LLM**: `server/_core/llm.ts` — OpenAI-compatible chat completion client (`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`), used for summaries, flashcards, quizzes, study guides, email drafts, and the AI tutor chat.
- **Transactional email**: `server/email.ts` — Resend (`RESEND_API_KEY`/`RESEND_FROM_EMAIL`); the sending domain must be one the owner controls and has verified in Resend (the historical default, `studyscribe-ai.manus.space`, is Manus-managed and can't be used for this).
- **Browser push**: `server/pushNotifications.ts` — Web Push with VAPID keys.

### Frontend

Vite + React 19, routed with `wouter` (not react-router) in `client/src/App.tsx`, where page components are `React.lazy` code-split — add new pages the same way. `ProtectedRoute` wraps authenticated pages and reads auth state from `useCustomAuth` (`client/src/_core/hooks/useCustomAuth.ts`), which talks to the custom REST session endpoints, not tRPC, for the initial auth check. Data fetching for everything else goes through the tRPC client + TanStack Query. UI components are shadcn/ui (`client/src/components/ui`) on Tailwind v4. Path aliases (`@` → `client/src`, `@shared` → `shared/`) are defined in both `vite.config.ts` and `tsconfig.json` — keep them in sync if either changes; `vitest.config.ts` also duplicates them for tests.

The `/demo` page plays `client/public/demo/studyscribe-demo.mp4` when present (built from screenshots by `scripts/make-demo-video.swift`: `swiftc -O scripts/make-demo-video.swift -o /tmp/mkvideo && /tmp/mkvideo slides.json client/public/demo/studyscribe-demo.mp4`, macOS only) and otherwise falls back to a slideshow of `client/public/demo/*.jpg` (`DemoWalkthrough.tsx`).

`shared/` holds code imported by both client and server (`shared/const.ts` for shared string constants, `shared/types.ts`) — put cross-cutting constants there rather than duplicating them.

### Deployment

Vercel is the active production target: `vercel.json` builds with `npm run build`, routes `/api/*` to the bundled `api/index.mjs` handler, and serves the SPA for everything else. Deploys are automatic on push to `main` via Vercel's GitHub integration — there is no separate deploy step or CI gate to run manually; check deploy status via the GitHub commit status API (`context: "Vercel"`) or the Vercel dashboard. `render.yaml`/`railway.json`/`railway.toml`/`Procfile`/`render-build.sh` exist from an evaluated-but-not-completed migration off Vercel; don't assume they're current.
