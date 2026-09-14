# StudyScribe AI

StudyScribe AI turns recorded lectures and meetings into study material. Record or upload audio, get it transcribed (with speaker diarization), and generate AI study notes, flashcards, quizzes, study guides, and email/document drafts from the transcript — plus an AI tutor chat scoped to that recording.

It's a full-stack app: a React SPA talking to an Express/tRPC API, backed by a TiDB Cloud (MySQL-compatible) database via Drizzle ORM. It's currently live on Vercel at [studyscribe-ai.vercel.app](https://studyscribe-ai.vercel.app).

## Features

- **Record or upload** lectures/meetings (audio, up to 16MB)
- **Transcription with speaker diarization** via AssemblyAI, processed asynchronously
- **AI study tools** generated from the transcript: study notes, flashcards (with spaced-repetition-style review, learn mode, test mode), quizzes, study guides, and email/document drafts
- **AI tutor chat** scoped to a recording's content
- **Knowledge base search** across all your transcripts
- **Custom auth**: invite-gated email/password + Google OAuth, with an admin flow for reviewing access requests and issuing invite codes
- **Sharing**: generate a no-login public link for a recording, or share it directly with another StudyScribe account
- **Admin dashboard**: manage invite requests/codes and user roles at `/admin`
- Browser push notifications, in-app notification center, analytics dashboard

## Tech stack

- **Frontend**: React 19, Vite, [wouter](https://github.com/molefrog/wouter) for routing, TanStack Query, shadcn/ui + Tailwind v4
- **Backend**: Express + [tRPC](https://trpc.io) (most of the API), plus a few plain REST routes for auth and webhooks
- **Database**: TiDB Cloud (MySQL-compatible) via [Drizzle ORM](https://orm.drizzle.team)
- **AI/transcription**: AssemblyAI (speaker diarization), an OpenAI-compatible chat completion API for study-tool generation
- **Storage**: Vercel Blob
- **Email**: Resend
- **Hosting**: Vercel (serverless functions), with the app also portable to a standalone Node server (Railway/Render configs exist but aren't the active deployment)

See [CLAUDE.md](CLAUDE.md) for a deeper architecture walkthrough (bootstrapping, auth model, database env-var resolution, provider abstractions).

## Getting started

```bash
npm install --include=dev --no-audit --no-fund
npm run dev
```

This starts an Express server with Vite middleware for HMR, on the first free port from 3000.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TIDB_HOST` / `TIDB_PORT` / `TIDB_USER` / `TIDB_PASSWORD` / `TIDB_DATABASE` (or `DB_*` equivalents, or `DATABASE_URL`) | Database connection — see `getExternalDatabaseConfig()` in `server/db.ts` for precedence |
| `JWT_SECRET` | Signs session cookies |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `PUBLIC_APP_URL` or `APP_URL` | Canonical app origin, used for OAuth redirects and password-reset links |
| `ASSEMBLYAI_API_KEY` / `ASSEMBLYAI_WEBHOOK_SECRET` | Transcription + speaker diarization |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | AI study-tool generation (OpenAI-compatible) |
| `BLOB_READ_WRITE_TOKEN` (or `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`) | Vercel Blob storage for recordings |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Transactional email (password reset) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Browser push notifications |

### Common commands

```bash
npm run build       # production build (client + server bundle)
npm start           # run the built standalone server
npm run check       # TypeScript check
npm test            # run the test suite (vitest)
npm run format      # prettier
npm run db:push     # generate + apply a new Drizzle migration
npm run db:migrate  # apply committed migrations only
```

## Deployment

Production runs on Vercel, deploying automatically on push to `main`. Database schema migrations don't run automatically on deploy — they need to be applied against the live database separately (see the migration files under `drizzle/` and `server/schemaInit.ts`).

## Project structure

```
client/src/       React app (pages, components, hooks)
server/           Express app, tRPC routers, auth, provider integrations
drizzle/          Database schema and migrations
shared/           Code shared between client and server
```

See [CLAUDE.md](CLAUDE.md) for details on how these fit together.
