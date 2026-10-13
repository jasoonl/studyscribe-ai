# StudyScribe AI — Feature Gap Analysis & Roadmap (vs. Otter.ai and Cluely)

_Last updated: 2026-10-13. Supersedes the scope of `competitor-benchmark.md` (Day 6), which is kept for history._

## Ground rules for every item in this plan

1. **Keep everything.** No existing page, procedure or flow is removed. New work extends what is there (e.g. the AI tutor grows a cross-recording mode; it is not replaced).
2. **Same design language.** New UI is built from the existing shadcn/ui components in `client/src/components/ui`, the Tailwind v4 tokens in `client/src/index.css` (StudyScribe blues, Geist), `DashboardLayout`, and the card/tab patterns already used on `RecordingDetail` (rounded-xl bordered cards, primary-filled active tab). No new component library, no new palette.
3. **Same architecture.** New server work goes in `server/routers.ts` (tRPC, `protectedProcedure`), query helpers in `server/db.ts`, tables in `drizzle/schema.ts` with committed TiDB-safe SQL migrations (`DEFAULT CURRENT_TIMESTAMP`, no JSON defaults). New pages are `React.lazy` routes in `client/src/App.tsx` wrapped in `ProtectedRoute`.
4. **Respect the Vercel 60s limit.** Anything long-running (live transcription, meeting bots, bulk AI jobs) follows the existing submit → webhook/poll pattern. No request waits out a long job.
5. **Study-first, not stealth.** We adopt Cluely's *real-time help* idea but not its "undetectable" positioning. Every live feature is visible, consent-noticed (`RecordingConsentNotice`), and framed around learning.

---

## 1. What the competitors offer (summary)

### Otter.ai — "meeting intelligence platform"
- **OtterPilot / meeting agent**: a bot auto-joins Zoom, Google Meet and Teams from the calendar, records, transcribes live, captures slides.
- **Live transcription** visible to participants while the meeting runs; live notes.
- **Automatic summary + action items**, grouped and assigned to named owners.
- **Otter AI Chat** across *all* meetings ("what did we decide about X last month?").
- **Speaker identification** that learns voices; rename speakers.
- **Collaboration**: channels/workspaces, shared folders, comments and highlights on transcript lines, @mentions, auto-share to attendees.
- **Custom vocabulary** (names, jargon) to improve accuracy.
- **Editing & playback**: edit transcript inline, speed control, skip silence, keyword cloud, in-transcript search.
- **Exports**: TXT, DOCX, PDF, SRT; audio download.
- **Integrations**: Google/Outlook calendar, Slack, Notion, Google Drive/Dropbox, Salesforce/HubSpot, Zapier; Otter API.
- **Apps everywhere**: iOS, Android, Chrome extension, desktop.
- **Teams/billing**: team plans, admin console, SSO, usage minutes.

### Cluely — real-time "AI that sees your screen and hears your calls"
- **Desktop app with an always-on-top overlay** that shows live suggestions during a call.
- **Hears system audio + mic** without a bot joining the meeting.
- **Screen awareness**: reads what is on screen to give context-aware answers.
- **"Ask" hotkey**: ask anything mid-call; "What should I say?", "Recap the last 2 minutes", "Define this term".
- **Live recap** of what was just said; follow-up suggestions.
- **Post-call notes**, transcript, action items, follow-up email draft.
- Positioned (controversially) as **undetectable** in screen shares — we deliberately do **not** copy this.

Sources: [Sonix — Otter.ai Review 2026](https://sonix.ai/resources/otter-ai-review-pricing/), [Builts — What is Cluely](https://builts.ai/blog/what-is-cluely/), [Dupple — Cluely review (Jul 2026)](https://dupple.com/reviews/cluely), [aisotools — Cluely review 2026](https://aisotools.com/blog/cluely-review-2026), plus the references in `competitor-benchmark.md`. Several of these are third-party/affiliate reviews; re-check plan-tier details on the vendors' own sites before quoting them publicly.

---

## 2. What StudyScribe already has (baseline — all kept)

| Area | Today |
|---|---|
| Capture | Browser mic recording (`Record`, `RecordOrUpload`), file upload up to 1GB incl. multipart >50MB, link import (direct media, media pages, YouTube via proxy/relay) |
| Transcription | AssemblyAI, speaker diarization, auto language detection or chosen language, webhook or polling, retry, segment splitting |
| Transcript UX | Click-to-seek segments, byte-range audio player with speed control, transcript editing (`transcription.update`) |
| AI study tools | Study notes (summary, key concepts, action items, formulas, study guide), flashcards + spaced review (Learn/Test modes), quizzes + attempts, study guides, email drafts, per-recording AI tutor chat |
| Knowledge | Knowledge Base search across recordings |
| Sharing | Public link, share with user, Shared With Me |
| Account | Invite-gated signup, email/password + Google, password reset, data export, account deletion, Trash/restore |
| Notifications | In-app notifications, Web Push |
| Analytics | Personal analytics overview |
| Admin | Diagnostics (transcription/storage/YouTube), invite requests/codes |
| Export | Markdown notes/flashcards, HTML-for-PDF |

---

## 3. Gap list — what Otter/Cluely have that StudyScribe does not

Legend: **Src** = O (Otter), C (Cluely), O+C (both). **Effort**: S (≤2 days), M (≤1 week), L (1–3 weeks), XL (>3 weeks).

### A. Capture & real-time

| # | Gap | Src | StudyScribe adaptation | Effort |
|---|---|---|---|---|
| A1 | **Live transcription while recording** (shipped, Phase 3) | O+C | Words appear on the Record page as you speak, using AssemblyAI's streaming (Universal-Streaming) API with a short-lived token minted by the server. The final file still goes through the existing batch pipeline for the authoritative diarized transcript. | L |
| A2 | **Live Lecture Companion** (shipped as "Study help", Phase 3) (Cluely-style overlay, ethical) | C | A side panel on the Record page (and later the desktop app / mobile app) with buttons: *Explain that term*, *Recap last 2 min*, *What's likely on the exam?*, *Questions to ask the professor*. Uses the rolling live transcript as context. Clearly visible, no stealth mode. | L |
| A3 | **System / tab audio capture** (shipped, Phase 3) (record a Zoom/YouTube lecture playing on the computer) | C | `getDisplayMedia({ audio: true })` option on the Record page ("Record a tab or screen audio"), mixed with mic via Web Audio. Chrome/Edge only; hide the option where unsupported. | M |
| A4 | **Meeting bot that joins Zoom/Meet/Teams** | O | Integrate a bot provider (e.g. Recall.ai) rather than building one: user pastes a meeting link or connects calendar → bot joins → recording lands as a normal `recordings` row via webhook. | XL |
| A5 | **Calendar integration** (auto-join scheduled classes/meetings, auto-title) | O | Google Calendar read-only OAuth (reuse Google OAuth client). Shows "Upcoming" on Dashboard; one-click "Send bot" (A4) or "Remind me to record". | L |
| A6 | **Slide / screenshot capture** | O | During screen-audio recording (A3), capture a frame every N seconds when it changes; store as images linked to timestamps; show inline in transcript. | L |
| A7 | **Bookmarks / highlights while recording** | O | "Mark this moment" button + keyboard shortcut during recording; stored as timestamped markers, shown in transcript and fed to the AI ("explain my bookmarked parts"). | S |
| A8 | **Pause / resume recording** | O | Pause/resume in `Record` via `MediaRecorder.pause()`. | S |

### B. Transcript quality & editing

| # | Gap | Src | Adaptation | Effort |
|---|---|---|---|---|
| B1 | **Rename speakers** ("Speaker A" → "Prof. Lee") applied across the transcript | O | `speakerLabels` map on `transcripts` (or new `transcriptSpeakers` table); rename UI on speaker chip. | S |
| B2 | **Custom vocabulary** (course terms, names) | O | Per-user and per-recording word list sent as AssemblyAI `word_boost`/keyterms on submission and retry. Settings page section. | S |
| B3 | **In-transcript search with highlight & jump** | O | Search box above the transcript tab; highlights matches, next/prev, seeks audio. | S |
| B4 | **Auto-scroll / karaoke follow-along** | O | Highlight the active segment while audio plays (AudioPlayer already emits `onTimeUpdate`). | S |
| B5 | **Skip silence** in playback (shipped, Phase 4) | O | Use word timestamps to compute silent gaps > 2s; player jumps them when toggle is on. | M |
| B6 | **Keyword cloud / topic chips** | O | LLM or TF-IDF keywords stored with the transcript; chips filter the transcript. | S |
| B7 | **Comments & highlights on transcript lines** (shipped, Phase 4) | O | `transcriptAnnotations` table (segment index, type highlight/comment, text, author). Visible to people the recording is shared with. | M |
| B8 | **Chapters / auto outline with timestamps** | O | New note type `outline` (`studyNotes.type` enum extension) with timestamped sections that seek on click. | M |

### C. AI intelligence

| # | Gap | Src | Adaptation | Effort |
|---|---|---|---|---|
| C1 | **Cross-recording AI chat** ("What did the professor say about mitosis across all lectures?") | O | "Ask StudyScribe" page: retrieve top segments via Knowledge Base search (later embeddings, C2) → LLM answer with citations that link to `recording/:id?t=`. Extends the existing tutor; per-recording tutor stays. | M |
| C2 | **Semantic search (embeddings)** (shipped, Phase 4) | O | `transcriptChunks` table with embedding vectors (TiDB supports vector columns) generated after transcription completes; Knowledge Base gets a "smart search" toggle. | L |
| C3 | **Action items with owners & due dates; checkable** | O | Structured `actionItems` table generated from the existing `action_items` note type; checkbox UI; Dashboard "To-do" widget. For students: assignments/deadlines extraction. | M |
| C4 | **Automatic summary on completion** (no button click) | O | After `finalizeCompletedTranscription`, enqueue summary generation (polling-safe: generate on first view if not ready, or via a follow-up webhook/cron). User setting to opt out. | S |
| C5 | **Custom summary templates** (Lecture, Lab, Seminar, Meeting, Interview) | O | Template picker on generate; templates are prompt presets in `shared/`. | S |
| C6 | **Live Q&A during recording** | C | Part of A2. | — |
| C7 | **Follow-up suggestions after a session** (shipped, Phase 3) ("Review these 3 concepts tomorrow") | C | Post-processing card on RecordingDetail; ties into flashcard spaced review and push notifications. | S |
| C8 | **Multi-recording study guide / exam pack** | O | Select several recordings (a course) → one combined study guide + quiz. | M |

### D. Organisation & collaboration

| # | Gap | Src | Adaptation | Effort |
|---|---|---|---|---|
| D1 | **Folders / Courses** | O | `courses` table (name, color, term); recordings get `courseId`. Dashboard filter + course page. The `tags` tables already exist in the schema but have no router/UI — wire them up at the same time. | M |
| D2 | **Study groups / channels** (shipped, Phase 4) (Otter "channels") | O | `groups` + `groupMembers`; share a recording or course to a group; group feed. Builds on `recordingShares`. | L |
| D3 | **Share permissions** (view vs. comment vs. edit) (shipped, Phase 4) | O | Add `role` to `recordingShares`. | S |
| D4 | **Auto-share to attendees** | O | With calendar (A5), offer to share notes to event attendees by email (Resend). | M |

### E. Export & integrations

| # | Gap | Src | Adaptation | Effort |
|---|---|---|---|---|
| E1 | **TXT, DOCX, SRT/VTT export; audio download** | O | Extend `server/export.ts`; `docx` npm package for DOCX; SRT from segments. Add to `ExportButton`. | S |
| E2 | **Anki / Quizlet flashcard export** | — (student-specific) | CSV/TSV export importable by Anki and Quizlet. | S |
| E3 | **Notion / Google Docs / Google Drive export** (shipped, Phase 4: Notion and Google Docs) | O | OAuth connect per service; "Send to Notion/Docs" on notes. | M each |
| E4 | **Slack / Discord / Zapier webhooks** (shipped, Phase 4: generic signed webhooks) | O | Generic outgoing webhook per user ("on recording completed"), then native Slack later. | M |
| E5 | **Public API** | O | Personal API keys + REST wrapper over existing procedures. Low priority for students. | L |
| E6 | **Chrome extension** (shipped, Phase 5: `extension/`) | O+C | "Record this tab" + quick capture of a lecture video page → `createFromUrl`. | L |
| E7 | **Desktop app** (Mac/Windows) (shipped, Phase 5: Electron in `desktop/`; macOS system audio still to be checked on a Mac) | C | Electron/Tauri wrapper around the SPA adding system-audio capture and an always-on-top Live Companion window (A2). Reuses the web build. | XL |

### F. Platform, account & business

| # | Gap | Src | Adaptation | Effort |
|---|---|---|---|---|
| F1 | **Native mobile apps** | O | See `docs/plans/mobile-app-plan.md`. | XL |
| F2 | **Paid plans & usage minutes** | O+C | Stripe Checkout + customer portal; `subscriptions` + monthly `usage` (transcription minutes, AI generations). Pricing page already exists; `/billing` currently redirects there. | L |
| F3 | **Teams / education plan, admin console, SSO** | O | Org accounts, seat management, SAML/Google Workspace SSO. Later. | XL |
| F4 | **Open signup with free tier** (vs. invite-only) | O+C | Feature flag in `appSettings` to switch invite-gating off once billing/abuse limits exist. Invite flow stays available. | S |
| F5 | **Onboarding checklist & templates gallery** | O | Extend `OnboardingModal` into a Dashboard checklist. | S |
| F6 | **Accessibility: live captions mode** (shipped, Phase 3) | O | Full-screen large-text live captions view (A1) for hard-of-hearing students. | S |
| F7 | **Translation of transcripts/notes** | O+C | "Translate to…" using the LLM; reuses `shared/languages.ts`. | S |

---

## 4. Phased roadmap

Phases are ordered by student value ÷ effort, and so that each phase ships independently on `main` (Vercel auto-deploys).

### Phase 1 — Quick wins on the existing recording page (≈2 weeks) · shipped 2026-10-12

Status: B1 rename speakers (with merge), B3 search, B4 follow-along scrolling, A7 bookmarks (needs `npm run db:migrate` for migration 0018), A8 pause/resume (already existed), E1 TXT/SRT/VTT export, E2 Anki/Quizlet (already existed), C4 automatic notes, C5 note templates and F7 note translation are done. DOCX export is left out because it needs a new dependency, and transcript translation was left out because a long transcript can exceed the 60s function limit (it shipped in Phase 5, translated part by part).

B1 rename speakers · B3 transcript search · B4 follow-along highlight · A7 bookmarks · A8 pause/resume · E1 TXT/DOCX/SRT export · E2 Anki/Quizlet CSV · C4 auto-summary · C5 summary templates · F7 translate.
_Why first_: all build on existing components (`RecordingDetail` tabs, `AudioPlayer`, `ExportButton`, `studyNotes`), no new providers, no new env vars.

### Phase 2 — Organisation & cross-recording intelligence (≈3 weeks) · shipped 2026-10-12

Status (first slice shipped 2026-10-12, needs `npm run db:migrate` for migration 0019): D1 courses/folders + tags UI and C1 Ask StudyScribe are done. Courses use a `recordingCourses` join table instead of `recordings.courseId` so an unmigrated database keeps working, and the courses UI lives on the dashboard and `/courses/:id` because the dashboard does not use `DashboardLayout`. Ask uses keyword retrieval; embeddings (C2) would replace it.

Status (rest of Phase 2 shipped 2026-10-12, needs `npm run db:migrate` for migration 0020): C3 tasks and deadlines (per recording, a `/tasks` view grouped by due date, and "Coming up" on the dashboard; owners are kept for meetings), B6 key terms (chips that search the transcript), B8 chapters (stored as tagged `studyNotes` rows rather than a new enum value, so no migration), B2 custom vocabulary (Settings list plus per-recording terms, sent as AssemblyAI `keyterms_prompt`) and C8 exam packs (course or picked recordings, combined guide plus 15-question practice exam) are done. Phase 2 is complete. Not done: chapter markers on the player's slider, and per-course vocabulary lists.

D1 courses/folders + tags UI · C1 "Ask StudyScribe" cross-recording chat · C3 action items/assignments to-do · B2 custom vocabulary · B6 keyword chips · B8 chapters/outline · C8 multi-recording exam pack.

### Phase 3 — Real-time (the Otter + Cluely core) (≈4 weeks) · shipped 2026-10-12

Status (needs `npm run db:migrate` for migration 0021, and `CRON_SECRET` set in Vercel for follow-up reminders): A1 live transcription (browser streams 16 kHz PCM16 from an AudioWorklet on the recorder's own Web Audio mix to AssemblyAI Universal-Streaming v3 with a token from `recordings.liveToken`; opt-in per browser because streaming is billed per minute; live mode shown in `diagnostics.transcription`), A2 Study help panel (`ai.liveAssist`, rate limited, 25s cap, no stealth mode), A3 tab or screen audio (desktop Chromium only, mixed with the mic; stopping the share keeps the recording going), F6 full-screen live captions (white on black, five sizes, keyboard exit) and C7 follow-up suggestions (stored per recording, practice steps link to flashcards, daily in-app and push reminder via Vercel Cron) are done. Live text and Study help answers are not stored. Verified against a local mock of the streaming API and an OpenAI-compatible mock (`scripts/dev/mock-live-services.mjs`); not yet run against the real AssemblyAI streaming service. Not done: speaker labels in live text, live text inside `RecordingIndicator`, and Study help on pages other than the record pages.

A1 live transcription · A2 Live Lecture Companion panel · A3 tab/system audio · F6 live captions mode · C7 follow-up suggestions.
_Technical note_: AssemblyAI streaming is a WebSocket from the **browser** directly to AssemblyAI using a temporary token from a new `recordings.liveToken` procedure, so no Vercel function holds the socket open. Companion prompts call a new `ai.liveAssist` mutation with the last N seconds of live text — each call is short and well under 60s.

### Phase 4 — Collaboration & integrations (≈4 weeks) · shipped 2026-10-12

Status (needs `npm run db:migrate` for migration 0022; until then the features below report "not set up on this server" and sharing keeps working as view only): D3 share roles (view, comment, edit on direct and group shares, checked on the server by `requireRecordingAccess` for every shared-content procedure; edit allows correcting transcript text and renaming speakers), B7 comments and highlights (select words in a line, or use the line's keyboard button; threads with replies, resolve, delete; owner moderates; hidden from view-only shares and public links), D2 study groups (members by email or join link, share a recording or a whole course at a role, group page with what's shared and recent comments), C2 smart search (OpenAI-compatible embeddings stored as float32 BLOBs and ranked in Node, so it also runs on MySQL/MariaDB; Ask fuses keyword and embedding rankings and falls back to keywords; off unless `OPENAI_EMBEDDING_MODEL` is set), B5 skip silence (gaps of 2s or more between transcript segments; no audio-energy analysis), E4 outgoing webhooks (HMAC-signed, SSRF-checked with the connection pinned, retried with backoff from the event's request, Settings and the existing daily cron; test and redeliver in Settings) and E3 Send to Notion / Google Docs for notes and study guides (per-person OAuth, `drive.file` scope only, tokens encrypted at rest, disconnect revokes). Verified in Chromium against local MariaDB with a mock of the embeddings, chat, webhook, Notion, Google and AssemblyAI endpoints (`scripts/dev/mock-phase4-services.mjs`); not yet run against the real Notion and Google APIs. Not done: native Slack/Discord apps (a generic webhook covers them through Zapier or Make), @mentions in comments, comments on transcripts without timed segments, Google Drive file export other than Docs, and a Knowledge Base "smart search" toggle (Ask uses it).

B7 comments/highlights · D2 study groups · D3 share roles · E3 Notion/Google Docs · E4 webhooks · C2 embeddings search · B5 skip silence.

### Phase 5 — Reach & revenue (ongoing) · first slice shipped 2026-10-13, second slice built 2026-10-13

Status (first slice, needs `npm run db:migrate` for migration 0023; until then billing, usage, saved translations and calendar reminders report "not set up on this server" and nothing else changes): F2 Stripe billing + usage limits (Checkout in subscription mode with promotion codes and optional Stripe Tax, the customer portal for plan changes, card and cancelling, a raw-body signature-verified webhook that is idempotent by event id and ignores out-of-order events, a monthly usage ledger of transcription minutes and AI generations with PROPOSED allowances in `shared/plans.ts`, limits enforced on recording create/import/retry and every AI generation only once Stripe is configured or `USAGE_LIMITS_ENFORCED=true`, a real `/billing` page, usage meters in Settings, billing status on the Admin page, and account deletion that cancels the subscription first), F4 open sign-up flag (admin switch in `appSettings`, only while limits are enforced; per-IP and daily caps; email confirmation through Resend for open sign-ups; landing copy follows the flag), F5 onboarding checklist (five steps from real data on the library), F7 translation of transcripts, study guides and notes (part by part within the 60s limit, stored, one generation per item and language) and A5 Google Calendar (read-only connection on the integrations framework, next seven days on the dashboard, Remind me to record delivered by open tabs at the start time plus a daily digest from the existing cron, and recordings named after the event) are done. Verified in Chromium against local MariaDB with `scripts/dev/mock-phase5-services.mjs` standing in for Stripe, the LLM, Google Calendar, Resend and AssemblyAI; not yet run against real Stripe or Google. Not done in this slice: D4 auto-share notes to event attendees, a templates gallery for F5, reminders at event start when no tab is open (needs a more frequent cron than Hobby allows, or a push service with scheduling), calendars other than the primary one, annual billing, and checking an invite on Google sign-up while sign-up is closed.

Status (part 2, built 2026-10-13, needs `npm run db:migrate` for migrations 0024 to 0028): Google sign-up now checks the invite (signed OAuth state, invite claimed atomically, open sign-up limits apply). E5 public API (personal hashed keys with read/write scopes, `/api/v1` over the existing procedures with per-key rate limits and plan usage, `/developers`). A6 slide capture (opt-in, perceptual diff on a 32x18 grid, steady-frame rule, JPEG 1280px, 40 per recording, inline in the transcript and a Slides strip). A4 meeting note-taker through Recall.ai (signed webhook, polling and daily-cron fallbacks, consent in the bot's name, chat and a required checkbox, Recall's copy deleted after import). D4 email notes to attendees (preview, per-person checkboxes, nothing automatic, opt-out link and postal address, opt-outs honoured for every sender). F3 teams (owner/admin/member, invitations, shared course library, admin console with usage, per-seat Stripe price, verified domain with Google Workspace auto-join, SAML through WorkOS). Verified in Chromium against local MariaDB with `scripts/dev/mock-phase5-platform.mjs`; not yet run against real Recall.ai, WorkOS or Stripe. Not done: SSO-only enforcement for a team (members can still use passwords), SCIM provisioning, the bot joining from a calendar automatically without a click, slides in public share links, and a crash backup for captured slides.

Apps slice (no server or web changes, no migrations): E6 Chrome extension (`extension/`, Manifest V3: popup with the site session, recent recordings, "Import this page" through `recordings.createFromUrl` and "Record this tab" with optional microphone in an offscreen document, badge timer, upload through the site's presigned endpoints; store listing and privacy text) and E7 desktop app (`desktop/`, Electron: system audio answering the record page's existing tab/screen audio option, an always-on-top compact Study help window that keeps the same page so a recording carries on, `studyscribe://` links, locked navigation and permissions, electron-builder for DMG, NSIS and AppImage). Verified in Chromium and Electron under Xvfb against local MariaDB with mocks; not yet published to the Chrome Web Store, signed, or run on a Mac or Windows machine.

Done: F2 Stripe billing + usage limits · F4 open signup flag · F5 onboarding checklist · F7 translation · A5 calendar · E5 public API · A6 slide capture · A4 meeting bot · D4 email notes to attendees · F3 teams/SSO · E6 Chrome extension · E7 desktop app.
Remaining: F1 mobile apps (parallel track, see mobile plan).

---

## 5. Detailed specs for the first items to build

### 5.1 Rename speakers (B1)
- **Schema**: `transcripts.speakerNames` `text` (JSON string, nullable — no JSON default for TiDB). Shape: `{ "A": "Prof. Lee", "B": "Me" }`.
- **Server**: `transcription.renameSpeaker({ recordingId, speaker, name })` (protected, ownership check like `transcription.update`).
- **Client**: in the transcript tab, the speaker label becomes a `Popover` with an `Input`; all segments for that speaker update. Names are also passed into LLM prompts so notes say "Prof. Lee explained…".
- **Tests**: `server/speakerNames.test.ts` for the JSON merge/validation helper.

### 5.2 Transcript search + follow-along (B3, B4)
- **Client only.** `Input` with search icon above the segment list; matches wrapped in `<mark className="bg-primary/20">`; `↑/↓` buttons; Enter seeks. Active segment = last segment whose `start <= currentTime`, styled `border-primary bg-primary/5`, auto-scrolled into view unless the user has scrolled manually in the last 5s.

### 5.3 Bookmarks while recording (A7)
- **Schema**: `recordingBookmarks` (id, recordingId, userId, atSeconds int, label varchar(255) null, createdAt `DEFAULT CURRENT_TIMESTAMP`).
- **Server**: `bookmarks.list/add/remove`. Bookmarks made during a recording are buffered client-side and saved after `recordings.create` returns the id.
- **Client**: "Mark moment" `Button` (and `B` key) on `Record`/`RecordOrUpload`; markers on the `AudioPlayer` slider track; a "Bookmarks" chip row in the transcript tab.

### 5.4 Exports (E1, E2)
- `server/export.ts`: `generatePlainTranscript`, `generateSrt`, `generateVtt`, `generateDocx` (via `docx` package — add to both lockfiles per CLAUDE.md), `generateAnkiCsv`, `generateQuizletTsv`.
- `ExportButton` dropdown gains the new formats; flashcard tab gains "Export to Anki / Quizlet".

### 5.5 Live transcription + Live Lecture Companion (A1, A2)
- **Server**: `recordings.liveToken` → calls AssemblyAI temporary-token endpoint (expires in ~60s, single session). `ai.liveAssist({ recordingDraftId?, transcriptWindow, action })` where `action ∈ explain | recap | examFocus | questions | custom`.
- **Client**: `client/src/lib/liveTranscription.ts` opens the streaming WebSocket, feeds 16kHz PCM from an `AudioWorklet`, emits partial/final turns. The Record page shows a split view: left = live transcript (large, readable), right = Companion card with the action buttons styled like the existing RecordingDetail tab cards. On stop, the normal upload + batch transcription run as today; the live text is discarded once the authoritative transcript lands.
- **Guardrails**: consent notice stays; Companion is labelled "Study help"; no "hide from screen share" option.
- **Env**: none new (reuses `ASSEMBLYAI_API_KEY`); add mode/status to `diagnostics.transcription`.

### 5.6 Courses / folders (D1)
- **Schema**: `courses` (id, userId, name, color varchar(16), term varchar(64) null, archived boolean default false, createdAt); `recordings.courseId` int null.
- **Server**: `courses.list/create/update/archive`, `recordings.setCourse`; `recordings.list` gains optional `courseId` filter.
- **Client**: Dashboard sidebar section "Courses" (in `DashboardLayout`), color dots, a course page reusing the Dashboard recording grid. Also add the missing tags UI using the existing `tags`/`recordingTags` tables.

### 5.7 Ask StudyScribe (C1)
- **Server**: `ai.askAcrossRecordings({ question, courseId? })` → reuse the Knowledge Base search helper to collect top ~20 matching segments (with recording id + start time) → LLM with instructions to cite as `[n]` → return `{ answer, citations: [{recordingId, title, start, snippet}] }`. Store in `chatHistory` with `recordingId = null` (make column nullable in a migration if needed).
- **Client**: new lazy page `/ask` using `AIChatBox`; citations render as chips that navigate to `/recording/:id?t=<start>` (RecordingDetail reads `t` and calls `seekTo`).

---

## 6. Design consistency checklist (apply to every PR)
- [ ] Uses `DashboardLayout` for authenticated pages; mobile layout checked at 375px.
- [ ] Only shadcn/ui primitives from `client/src/components/ui`; icons from the same icon sets already in use (`lucide-react`, `@hugeicons/react`).
- [ ] Colors via tokens (`bg-primary`, `text-muted-foreground`, `border-border`) — no hex literals; works in light and dark.
- [ ] Cards: `rounded-xl border border-border bg-card shadow-sm`, hover lift as on RecordingDetail tabs.
- [ ] Loading = existing skeletons / `AIProgressBar`; errors = toast (sonner) with an explanatory message.
- [ ] Durations through `formatRecordingDuration`.
- [ ] Any page that shows a processing recording keeps polling `recordings.getStatus`.
- [ ] Help page (`Help.tsx`) and demo storyboard updated when a user-visible feature lands.

## 7. Explicitly out of scope
- "Undetectable" / hidden-from-screen-share overlays, exam or interview answer scripting.
- Recording other people without a consent notice.
- Scraping streaming sites whose terms forbid it (existing `STREAMING_PAGE_HOSTS` policy stands).
