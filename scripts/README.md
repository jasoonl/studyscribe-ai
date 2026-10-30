# Scripts

Development and maintenance tools. None of these run as part of the build or deploy.

| Folder | What's in it |
| --- | --- |
| `dev/` | Local mock servers that stand in for AssemblyAI, OpenAI, Stripe, Google, Recall.ai and others, so every feature runs without keys (how to start each one is in [CLAUDE.md](../CLAUDE.md)), plus `list-procedures.ts`, which prints every tRPC procedure. |
| `evals/` | The AI quality eval runner behind `npm run evals` ([evals/README.md](../evals/README.md)). |
| `demo-video/` | The `/demo` video pipeline. `v2/` is current; the Swift pipeline at the folder root is superseded. |
| `landing/` | Retakes the landing page screenshots in `client/public/landing/`. |
| `youtube-relay/` | The self-hosted YouTube relay (`npm run relay`). |
| `db/` | One-off database tools from the move to TiDB: check which database a `DATABASE_URL` points at, list users as hashes, and the Phase 2 table migration that predates the committed Drizzle migrations. |
