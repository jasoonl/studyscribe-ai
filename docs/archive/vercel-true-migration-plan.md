# StudyScribe AI — True Vercel Migration Plan

**Status:** Architecture selected; provider accounts and environment configuration are required before data migration and live activation.

## Target Architecture

StudyScribe will run as a Vercel-served React single-page application plus an Express serverless function. The existing Manus deployment remains live as the rollback environment during migration. The Vercel deployment is already live at `https://studyscribe-ai.vercel.app`; its public app, SPA routing, API route mounting, and `/healthz` endpoint have been verified.

| Product capability | Current dependency | Vercel-compatible target | Required configuration |
|---|---|---|---|
| User files, recordings, playback | Manus Forge S3 proxy | Private Vercel Blob with short-lived signed upload/read URLs | Create and connect a private Blob store to the Vercel project |
| General transcripts and speaker labels | Manus Whisper plus AssemblyAI diarization | AssemblyAI pre-recorded transcription with speaker labels and signed private-Blob source URLs | `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_WEBHOOK_SECRET` |
| Study notes, flashcards, quizzes, tutor, email drafts | Manus Forge LLM | OpenAI Responses API | `OPENAI_API_KEY`, selected model names |
| Product data, custom accounts, sessions, notifications | Manus-managed TiDB | Project-owned TiDB Cloud Starter / Essential instance | `DATABASE_URL` with TLS enabled |
| Email/password sessions | Manus runtime secret | Vercel environment variable | Persistent `JWT_SECRET` |
| Google sign-in | Google credentials stored in Manus | Existing Google OAuth client, with Vercel callback added | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_APP_URL` |
| Browser push | Self-hosted Web Push | Same portable Web Push implementation | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Password reset and owner escalation email | Resend, pending verified sender | Same Resend implementation | Verified `RESEND_FROM_EMAIL`, `RESEND_API_KEY` |
| Owner operational alerts | Manus notification service | Vercel logs as baseline; Resend escalation after sender verification | Optional `RESEND_*` values |

## Storage and Upload Security

The target uses a **private Vercel Blob store**. Vercel’s documentation states that private Blob storage requires authentication for read and write operations, while short-lived signed URLs can grant a restricted third party temporary read access without exposing a storage credential. [1] [2]

The migration will replace the current base64 upload-to-server route with browser-to-Blob upload URLs. The app server will authenticate the StudyScribe session and constrain the Blob pathname to the signed-in user, accepted MIME types, upload size, and a short expiration. This avoids Vercel function request-size limits and keeps recordings unavailable from public URLs.

## Transcription Architecture

AssemblyAI will become the single asynchronous transcription provider for Vercel. Each uploaded recording will receive a short-lived signed private-Blob GET URL, submitted with `speaker_labels: true` and an authenticated Vercel webhook URL. AssemblyAI documents that webhook deliveries contain the transcript ID and status, must receive a 2xx response within 10 seconds, and can be authenticated with a custom request header. [3] The webhook will fetch the finished transcript, normalize timestamped speaker segments, write the result to the owned recording, and trigger the existing in-app/browser notification flow.

This design does not rely on a Vercel function remaining alive while transcription runs. It also preserves the existing transcript status polling experience.

## AI Architecture

The existing study-generation and assistant prompts will be routed to the OpenAI API using `OPENAI_API_KEY` only on the server. OpenAI’s Responses API supports text inputs, text outputs, and structured output patterns; its transcription API is not selected as the primary path because the existing product already uses AssemblyAI speaker labels and asynchronous webhook completion. [4] [5]

## Required Owner Actions Before Live Activation

1. In the Vercel project, create a **private Blob** store and connect it to Production, Preview, and Development. Vercel automatically provides the Blob runtime variables when the store is connected. [1]
2. Create a project-owned TiDB Cloud Starter or Essential database, generate a password, and retain its TLS connection string. TiDB Cloud Starter is a managed option with MySQL protocol compatibility, which matches the existing Drizzle/MySQL app. [6] [7]
3. Create or select an OpenAI API project and create an API key for the server-side AI functionality.
4. Create or select an AssemblyAI API key and create a high-entropy `ASSEMBLYAI_WEBHOOK_SECRET`. The secret must be inserted in Vercel, never in Git or chat.
5. Add `https://studyscribe-ai.vercel.app/api/auth/google/callback` to the existing Google OAuth client’s authorized redirect URIs. Keep the existing Manus callback until traffic migration has been accepted.
6. After the owned sender domain is available, add the Resend configuration and verify password-reset email on Vercel.
7. Generate a new VAPID key pair specifically for Vercel and store all VAPID values as Vercel environment variables. Existing browser subscriptions must opt in again because a new application server key requires a new subscription.

## Data Migration Safeguard

Database migration is a separate, one-way data operation and will not be started until the target TiDB connection is available and the owner explicitly confirms a migration window. The process will first export a verified snapshot, apply the existing Drizzle schema to the target, import data, check counts and foreign-key relationships, then perform a final read-only verification. Existing Manus storage keys will not be copied into the Vercel database as usable recording objects; active recording audio must be migrated to the new private Blob store or retained as archive-only links until copied.

## Current Limits

No provider credentials have been copied from Manus or committed to Git. As a result, the current Vercel URL is a healthy deployed shell and API runtime, but Google OAuth is intentionally unavailable until Vercel settings are completed. The Manus deployment remains the only complete production environment until the provider migration and data verification are finished.

## References

[1]: https://vercel.com/docs/vercel-blob/private-storage "Vercel Blob — Private Storage"
[2]: https://vercel.com/docs/vercel-blob/vercel-signed-urls "Vercel Blob — Signed URLs"
[3]: https://www.assemblyai.com/docs/pre-recorded-audio/webhooks "AssemblyAI — Webhooks for Pre-Recorded Audio"
[4]: https://developers.openai.com/api/reference/responses/overview/ "OpenAI — Responses Overview"
[5]: https://developers.openai.com/api/docs/guides/speech-to-text "OpenAI — Speech-to-Text Guide"
[6]: https://docs.pingcap.com/tidbcloud/tidb-cloud-quickstart "TiDB Cloud — Quick Start"
[7]: https://docs.pingcap.com/tidb/stable/mysql-compatibility/ "TiDB — MySQL Compatibility"
