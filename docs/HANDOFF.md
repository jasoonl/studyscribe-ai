# Handoff: where StudyScribe stands (2026-10-23)

Read this first in a new chat, then `CLAUDE.md` (how the code works) and `docs/plans/competitive-feature-roadmap.md` (what was planned and built).

## 1. The short version

- Phases 1 to 7 of the roadmap are built and merged to `main`, and Vercel deploys `main` automatically. Phase 7's two school items (LTI school integrations and instructor accounts) were deliberately set aside.
- The roadmap has nothing left. **Phase 8 is only a proposal (section 4), waiting for the owner to choose.** Don't build Phase 8 until the owner picks items.
- No pull requests are open. The last merged was #33.
- Much of what's built stays switched off until the owner runs the database updates and adds the service keys in section 3.

## 2. What the last sessions built (PRs #22 to #33)

| PR | What it did |
|---|---|
| #22 | UI pass. Library row actions moved into a "More actions" menu, Undo after moving to trash, a tidier library header and tabs, retaken landing screenshots, readable feature tiles, mobile Trash buttons. |
| #23 | Study planner (`/plan`) and progress page (`/progress`): spaced repetition around exam dates. Migration 0031. |
| #24 | Install as an app and offline review: keep a recording offline, review flashcards offline, reviews sync when back online. |
| #25 | AI quality checks (`npm run evals`): scores notes, flashcards, quizzes and Ask answers against the transcript. |
| #26 | Referrals (`/invite-friends`) and a "Made with StudyScribe" block on public share pages. Migration 0032. Reward amounts are PROPOSED. |
| #27 | Real sign-out: logging out or "Sign out of all devices" actually revokes the session. Password reset tokens are hashed. Migration 0033. |
| #28 | Plain, consistent messages when the AI service fails, and live checks for Resend, Recall.ai and WorkOS on System health. |
| #29 | Live transcription code loads only when a recording starts; the floating recording pill shows the latest live words. |
| #30, #31, #32 | The whole interface in Spanish, French, Simplified Chinese, Japanese and Korean, with a language picker in Settings, on sign-in and sign-up, and in the site footer. |
| #33 | Study help from any page while recording: the recording pill opens it in a side sheet with the live transcript. |

### About the translations
- English is the source in `shared/i18n/en.ts`. The other five files must contain every message (the type checker enforces it), and `server/i18n.test.ts` checks that placeholders and links survive translation.
- **New UI text must go through `t()`, in all six files in the same change.** A hard-coded English string on a translated page is a bug.
- Intentionally still English:
  - admin pages and the API docs (`/developers`)
  - the legal pages (the English text is the binding one)
  - server error messages and notification text
  - the landing page screenshots (they are images)
  - search-engine titles
- **No native speaker has reviewed the translations.** The Language card in Settings says so.

## 3. What the owner still has to do (nothing here can be done from code)

1. **Run `npm run db:migrate` against the production database.** This applies migrations 0024 to 0033. Until then these features read as "not set up on this server yet":
   - API keys, slide capture, meeting note-takers, emailing notes to attendees and teams (0024 to 0028)
   - the mobile app's tables (0029)
   - course vocabularies and faster lookups (0030)
   - planner tracking, referrals and real sign-out (0031 to 0033)
2. **Stripe** (paid plans are "Coming soon" until done). The steps are in the "Stripe setup" section of `CLAUDE.md`, including yearly prices.
   - Confirm the plan allowances in `shared/plans.ts`, which are PROPOSED.
   - Confirm the $12 per person Team price.
3. **Other settings in Vercel:**
   - `CRON_SECRET` (daily reminders)
   - `OPENAI_EMBEDDING_MODEL` (smart search)
   - Notion and Google keys (sending notes to apps)
   - Recall.ai keys (meeting note-taker)
   - WorkOS keys (school or company single sign-on)
   - `EMAIL_POSTAL_ADDRESS` (emailing notes)
4. **Mobile app setup:** accounts, signing, and the app store listings. See `mobile/README.md` and `mobile/STORE.md`.
5. **Upgrade Vercel Blob storage.** It is on the 1 GB free plan; when it fills up, every upload fails. After upgrading, set `BLOB_STORAGE_LIMIT_BYTES`.
6. **ElevenLabs** (demo video voice): move to a paid plan and replace the access key with a new one.
7. **Lawyer review** of the legal pages, the referral rewards and the Terms. Progress is tracked in `docs/compliance/legal-checklist.md`.
8. **Not yet tried for real:**
   - live transcription against the real AssemblyAI streaming service (only tested against a local stand-in)
   - the Chrome extension in the Chrome Web Store
   - the desktop app signed and run on a real Mac or Windows machine

## 4. Proposed Phase 8 (awaiting the owner's choice)

Items in the recommended order:

1. **Ready to launch.**
   - Test live transcription against real AssemblyAI.
   - Get native speakers to review each language.
   - Prepare the Chrome extension and desktop app for their stores.
2. **Phone app catches up.** It still lacks the study plan, progress, the five languages and Study help. The app can reuse `shared/i18n`.
3. **Emails and notifications in each person's language.** This needs a new small table for each person's language. That means a new migration numbered after 0033, and the code must tolerate the table being missing.
4. **Learning from mistakes.** After a quiz, explain each wrong answer from the lecture. Add timed practice exams.
5. **Owner dashboard.** Admin-only counts of sign-ups, first recordings and return visits, with no tracking of individuals.

When the owner picks items, add them to the roadmap as "Phase 8" before building.

## 5. How the owner likes work done

- One feature branch and one PR per phase or slice. Commit and push after every meaningful step.
- Open PRs as drafts. **Merge them yourself** once the Vercel status on the PR's latest commit is `success`:
  1. Check the status with `curl https://api.github.com/repos/jasoonl/studyscribe-ai/commits/<sha>/status`.
  2. Mark the PR ready.
  3. Merge with a merge commit, passing the full head SHA as `expectedHeadSha`.
- Before pushing, run `npm run check`, `npm test` and `npm run build`.
  - About 7 tests always fail without production secrets (googleOAuth, providerCredentials, schemaInit, transcriptionWebhook). That is expected.
  - For UI changes, also look at the page in a browser (Playwright against a local database) at 1440 and 375 wide.
- Database migrations:
  - Generate them offline, numbered after 0033.
  - Use `DEFAULT CURRENT_TIMESTAMP` and no JSON defaults.
  - Add new tables only (never columns on busy existing tables).
  - Code must keep working until the owner applies them (see `server/bookmarks.ts`).
- Design rules (the house rules in `.claude/skills/studyscribe-ui` win over generic advice). Never use:
  - purple-to-blue gradients, gradient text or glassmorphism
  - emoji in headings or as icons, or too many icons
  - buttons that only appear on hover by fading in
  - buzzwords
  - em dashes in UI copy
- **Write for a non-developer.** Explain in plain language what changed and what the owner must do. Remind the owner of section 3 once per session, not every message.

## 6. Practical notes for the next session

- **Local testing setup:**
  - Start MariaDB with `service mariadb start`.
  - The local database is `mysql://ss:ss@127.0.0.1:3306/studyscribe`, seeded with `scripts/demo-video/v2/seed-library.mjs`.
  - The demo login is `demo@example.com` / `demo-password-1`.
  - Run the app with `JWT_SECRET=dev-secret PUBLIC_APP_URL=http://localhost:3000 DATABASE_URL=… npm run dev`.
  - For live transcription and Study help, add the mock from `CLAUDE.md` (`scripts/dev/mock-live-services.mjs` with `MOCK_SILENCE_IS_SPEECH=1`) and Chromium's fake microphone flags.
  - The Playwright helper scripts from earlier sessions lived in `/tmp` and will be gone; rewrite them as needed.
- **Don't log in repeatedly in tests.** The login rate limit kicks in. Log in once and save the session (`storageState`).
- **Watch the usage limit.** Sessions hit it several times when three or more helper agents ran in parallel. Use fewer helpers, and checkpoint-commit often so nothing is lost if a session stops.
- **The roadmap's gap table (section 3)** still shows many rows without a "done" mark, but every one of them was built in Phases 1 to 6. The phase sections are the source of truth.
