# StudyScribe AI — Railway and Render Readiness Runbook

## Purpose and current boundary

StudyScribe AI is prepared for a controlled deployment evaluation on either Railway or Render. This preparation does **not** migrate production, change the live Manus deployment, or copy secrets into source control. The GitHub repository remains the source repository, while the current Manus deployment remains the rollback reference.

Both candidate platforms can run the current Node/Express production server. Railway’s official Express guidance supports GitHub-connected deployments, uses the project `start` script, and expects service environment variables to be configured in the platform dashboard. Render’s official Node/Express guidance supports GitHub-connected web services with explicit build/start commands, environment variables, and health checks. [1] [2]

## Recommended service shape

Start with one production web service because the current application serves the built React client, Express routes, tRPC procedures, custom authentication, and the background transcription launcher from the same Node process. The application now exposes `GET /healthz`, uses `pnpm build` followed by `pnpm start`, and binds to the platform-provided `PORT` in production. Local development still searches for an available port to avoid collisions.

The application now scans for non-deleted recordings still marked `processing` when the server starts and resumes their transcription, reducing the risk of stranded uploads after a redeploy. A later scale-up may still separate transcription into a durable worker and queue. Do not move to that architecture during the first hosting migration unless testing shows that the selected host can redeploy or sleep while a transcription job is running. The current application’s audio bytes remain in external storage rather than on the service filesystem.

| Concern | Railway | Render | Current StudyScribe preparation |
|---|---|---|---|
| GitHub deployment | Connect the selected repository and deploy the Node service | Create a Web Service from the selected repository | `package.json` contains portable build and start scripts |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm build` | Same command | Lockfile is committed and build succeeds locally |
| Start | `pnpm start` | `pnpm start` | Production command runs `NODE_ENV=production node dist/index.js` |
| Port | Platform-provided `PORT` | Platform-provided `PORT` | Production no longer changes the injected port |
| Health check | `/healthz` | `/healthz` | Lightweight JSON response, independent of providers |
| Database | External MySQL/TiDB URL or selected managed database | External MySQL/TiDB URL or selected managed database | Drizzle uses `DATABASE_URL`; use TLS where the provider requires it |
| Background work | Start with one web service; evaluate job durability | Start with one web service; evaluate job durability | Transcription is currently launched after upload and must be tested through redeploy/sleep scenarios |
| Persistent files | Do not rely on service disk | Do not rely on service disk | Audio and generated assets use external storage helpers |

## Required environment configuration

Add secrets through the chosen host’s secret/environment interface. Never commit a `.env` file, VAPID private key, JWT secret, OAuth secret, provider API key, or database password. Values marked **server-only** must not be exposed to the browser. Values beginning with `VITE_` are injected into the frontend bundle at build time and should contain only values safe for client exposure under the application’s existing design.

| Variable | Scope | Required for | Notes |
|---|---|---|---|
| `NODE_ENV=production` | Runtime | All deployments | Enables production static serving |
| `PORT` | Runtime | All deployments | Let Railway/Render inject this; do not set a fixed value |
| `PUBLIC_APP_URL` | Server | Auth and reset links | Set to the final HTTPS origin, including custom domain and no trailing path |
| `DATABASE_URL` | Server | Login, recordings, study tools, notifications | MySQL/TiDB connection string; use the provider’s TLS-enabled form |
| `JWT_SECRET` | Server | Custom sessions | Generate a new strong value for a new environment; do not reuse casually |
| `GOOGLE_CLIENT_ID` | Server | Google sign-in | Register the exact external-host origin and callback |
| `GOOGLE_CLIENT_SECRET` | Server | Google sign-in | Server-only |
| `BUILT_IN_FORGE_API_URL` | Server | Manus storage, LLM, maps, internal speech-to-text | Required while retaining the current Manus-backed service adapters |
| `BUILT_IN_FORGE_API_KEY` | Server | Manus storage, LLM, maps, internal speech-to-text | Server-only; never put in frontend variables |
| `VITE_FRONTEND_FORGE_API_URL` | Build | Frontend map integration and existing browser-facing helper | Confirm that this URL/key pair is explicitly intended for client use |
| `VITE_FRONTEND_FORGE_API_KEY` | Build | Existing frontend integration | Treat as public bundle data; do not use a server secret here |
| `VITE_APP_ID` | Build/runtime | Existing application configuration | Preserve the current application identifier unless a host-specific integration requires a replacement |
| `OAUTH_SERVER_URL` | Server | Legacy/Manus OAuth compatibility paths | Keep only if the deployed code path requires it; custom auth remains primary |
| `VITE_OAUTH_PORTAL_URL` | Build | Existing auth configuration | Preserve only if referenced by the deployed frontend |
| `OWNER_OPEN_ID`, `OWNER_NAME` | Server | Owner/admin notifications and metadata | Copy only through secret configuration |
| `ASSEMBLYAI_API_KEY` | Server | Speaker diarization | Required for the AssemblyAI path |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Server | Password-reset email | Keep disabled or incomplete until a domain the owner controls is verified |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Server | Browser push delivery | The private key is server-only; the public key is returned through the protected configuration procedure |
| `VITE_ANALYTICS_ENDPOINT`, `VITE_ANALYTICS_WEBSITE_ID` | Build | Optional analytics | Verify that the endpoint accepts the new origin |

## Google sign-in cutover checklist

Before testing Google sign-in on the external host, set `PUBLIC_APP_URL` to the exact HTTPS deployment origin. In Google Cloud Console, add the exact callback URL:

```text
https://YOUR_EXTERNAL_ORIGIN/api/auth/google/callback
```

The current application constructs this callback from the validated application origin, so the external host must not rely on the old Manus URL. Test both an existing-user login and a new-user signup if the invite-gating rules permit it. Confirm that the callback returns to `/dashboard`, the session cookie is present, and a hard refresh preserves authentication.

Do not remove the Manus callback URL until the external deployment has passed the complete auth test and a rollback window has elapsed.

## Feature verification matrix

| Feature | Required external dependency | Verification |
|---|---|---|
| Email/password login and logout | `DATABASE_URL`, `JWT_SECRET` | Sign in, refresh, sign out, and confirm protected-route redirect |
| Google sign-in | Google OAuth client plus exact external callback | Login and signup callback on the external HTTPS origin |
| Password reset | Verified Resend sender domain plus `RESEND_*` | Request reset, receive the email at an approved test address, complete one-time reset |
| Browser push | HTTPS, service worker, VAPID values, database table | Grant permission, persist subscription, receive a notification, click it, confirm destination |
| Recording | Browser microphone permission | Record, stop, save, observe upload/transcription status and redirect |
| Upload | External storage and provider API | Test MP3, WAV, OGG, WebM, M4A, and MP4 within the size limit |
| Transcription | `BUILT_IN_FORGE_*` and/or AssemblyAI | Verify text, timestamps, failure state, retry, and background completion |
| Speaker labels | `ASSEMBLYAI_API_KEY` | Use a multi-speaker sample and confirm labels align with timestamp navigation |
| AI study tools | LLM provider configuration | Generate study guide, quiz, flashcards, email draft, and tutor response |
| Knowledge base | Database | Search an owned transcript and open its recording |
| Notifications/reminders | Database and VAPID values for browser push | Create, dismiss, mark read, and test browser delivery |
| Storage | Manus storage adapter plus required server credentials | Upload, play, and reload an owned recording from a fresh session |
| Mobile experience | HTTPS browser | Check 375px and 768px layouts, recording controls, transcript tabs, and flashcard review |

## Migration order and rollback

First deploy the external service without changing DNS or removing the Manus deployment. Apply the existing Drizzle migrations to the intended database only after taking a provider-supported backup and confirming the target connection. Then set environment variables, deploy, check `/healthz`, and run the public landing-page smoke test. Next run authentication, recording/upload, transcription, AI, notification, storage, and mobile checks in that order.

Keep the Manus URL available as the rollback target. If an external deployment fails health checks, authentication callbacks, storage access, or transcription completion, route traffic back to Manus and remove only the new external deployment’s credentials—not the shared database or storage objects. Never run destructive database operations as part of the first deployment.

## Current blockers and decisions

The current code still depends on Manus-backed storage, built-in LLM, map, and Whisper adapters. This is portable to Railway or Render only if the corresponding server and build-time environment values remain available to the external service. If the goal is to become independent of Manus infrastructure, replace each adapter with a separately provisioned storage, LLM, maps, and transcription provider before migration. A free/sleeping web-service plan should not be treated as proof of durable background processing; test a redeploy during transcription and monitor the startup recovery logs.

Password-reset delivery is not production-ready until the owner verifies a domain they control in Resend. `studyscribe-ai.manus.space` is a Manus-managed subdomain and is not a substitute for an owned sending domain. Browser push is code-complete and its authenticated subscription path has been exercised, but native operating-system receipt and click routing require validation from a local browser/device surface.

The user must choose **Railway or Render** before account-specific deployment steps begin. No external service, domain, OAuth callback, DNS record, or production traffic has been changed by this preparation.

## References

[1]: https://docs.railway.com/guides/express "Railway — Deploy an Express App"
[2]: https://render.com/docs/deploy-node-express-app "Render — Deploy a Node Express App"
[3]: https://docs.railway.com/deployments/healthchecks "Railway — Healthchecks"
[4]: https://render.com/docs/health-checks "Render — Health Checks"
