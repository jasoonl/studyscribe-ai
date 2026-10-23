# Study Sources baseline

Measured on branch `claude/phase8-study-sources` at commit 65367b9 (the merge of PR #35, same tree as main; no source changes yet). Node deps installed with `npm install --include=dev --no-audit --no-fund`.

## Results
- `npm run check` (tsc --noEmit): PASS, no errors.
- `npm run build`: PASS (dist/index.js and dist/standalone.js about 801 kB).
- `npm test` (vitest run): 7 failed, 807 passed, 1 skipped (815 total). Files: 4 failed, 94 passed, 1 skipped (99).

## The 7 expected failures (missing production secrets)
- server/googleOAuth.test.ts (3): consent URL has client id and redirect uri; GOOGLE_CLIENT_ID/SECRET configured; client id looks valid.
- server/providerCredentials.test.ts (2): Resend and AssemblyAI authenticate; VAPID identity complete.
- server/schemaInit.test.ts (1): schema token authenticates before DB readiness check.
- server/transcriptionWebhook.test.ts (1): accepts the injected project secret.

Any failure outside these 7 is a regression.

## Migrations
- Highest existing: `drizzle/0033_phase7_session_revocations.sql` (journal idx 33, tag `0033_phase7_session_revocations`).
- Next one is number 0034.
- Style: 4-digit zero-padded number, then `phase<N>_<snake_case_topic>` (older ones, 0000 to 0002, use drizzle random names). Files live in `drizzle/`; each needs an entry in `drizzle/meta/_journal.json` (next idx 34, `"version": "5"`, `"breakpoints": true`) and a `drizzle/meta/0034_snapshot.json`. Suggested name: `0034_phase8_study_sources.sql`.

## Commands for a checker
Run from /home/user/studyscribe-ai:

    npm install --include=dev --no-audit --no-fund
    npm run check
    npm run build
    npx vitest run 2>&1 | grep -E "FAIL|Test Files|Tests "

Pass means: check and build exit 0, and the only FAIL lines are the 7 above (the Tests line should read 7 failed plus more passed than 807 as new tests are added; skipped stays 1).

Note: `npm install` rewrites package-lock.json locally; run `git checkout package-lock.json` afterwards unless a dependency change is intended.
