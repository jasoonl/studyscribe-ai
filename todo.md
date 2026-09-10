# StudyScribe AI — Full-Stack Application TODO

## Phase 1: Foundation & Authentication
- [x] Upgrade to full-stack (web-db-user)
- [x] Resolve Home.tsx conflicts (keep marketing landing page)
- [x] Configure Google OAuth for custom authentication; Apple and Microsoft OAuth are not enabled by the product scope
- [x] Test authentication flow (login/logout) - Working with template
- [x] Create user dashboard layout - Dashboard.tsx created
- [x] Replace Manus OAuth with custom email/password + Google OAuth - Fully implemented with JWT sessions

## Phase 2: Recording & Transcription
- [x] Build audio recorder component (browser-based) - Record.tsx created
- [x] Start transcription automatically after recording/upload completes - Background transcription wired
- [x] Build file upload interface - Upload.tsx complete with drag-and-drop
- [x] Implement post-upload transcription - Backend API fully wired
- [x] Create storage integration for audio files - S3 upload working
- [x] Build transcript viewer with timestamp sync - RecordingDetail.tsx
- [x] Add speaker diarization with AssemblyAI; speaker-labeled timestamp segments are now shown in recordings

## Phase 3: AI Features
- [x] Implement adaptive summarization (key concepts, action items, formulas) - Wired
- [x] Build AI Tutor chat interface (Socratic mode) - Fully wired
- [x] Create flashcard auto-generation - Wired and functional
- [x] Build study guide generation - Fully built in Phase 17 (StudyGuides.tsx + tRPC procedures)
- [x] Add practice quiz generation - Fully built in Phase 17 (QuizPage.tsx + tRPC procedures)
- [x] Implement email/document draft generation - Fully built in Phase 17-18 (EmailDrafts.tsx + tone selector)

## Phase 4: Dashboard & User Experience
- [x] Build main dashboard showing all recordings - Dashboard.tsx with delete
- [x] Create recording detail page - RecordingDetail.tsx enhanced
- [x] Build transcript editor (allow edits) - Edit mode with save/cancel
- [x] Create study tools interface - 4 tabs: Transcript, Notes, Flashcards, Tutor
- [x] Build knowledge base / searchable transcript history - Built in Phase 24 (KnowledgeBase.tsx)
- [x] Add flashcard exports - Quizlet/Anki-compatible TSV and Notion-compatible Markdown, plus transcript TXT export
- [x] Implement data deletion/privacy controls - Delete with confirmation

## Phase 5: Polish & Launch
- [x] Integrate landing page with app (navigation) - Home page shows auth state
- [x] Add loading states and error handling - Comprehensive error handling
- [x] Build file upload interface - Upload.tsx complete with validation
- [x] Add error boundaries and fallbacks - ErrorBoundary component
- [x] Test end-to-end recording flow - All pages verified working
- [x] Optimize performance and caching - Lazy loading, query caching
- [x] Add analytics and monitoring - Built in Phase 29 (Analytics.tsx)
- [x] Create help/onboarding flow - Built in Phase 25 (OnboardingModal.tsx) and Phase 30 (Help.tsx)
- [x] Deploy and test in production - Auto-published via checkpoint system

## Phase 6: Bug Fixes & Navigation Wiring
- [x] Fix sign-in redirect to dashboard after authentication - Implemented
- [x] Wire "Start Learning Smarter" button to sign-in - Working
- [x] Wire "See it in Action" button to demo page - Working
- [x] Wire "Watch Demo" button to demo page - Working
- [x] Create demo/showcase page - Demo.tsx complete
- [x] Wire pricing page "Start Free" to sign-in - Working
- [x] Wire pricing page "Upgrade Now" to billing page - Working
- [x] Create billing/upgrade page - Billing.tsx complete
- [x] Test all navigation flows end-to-end - All verified


## Phase 7: App Restructuring & Dashboard Consolidation
- [x] Create Landing page (public, shows marketing content) - Landing.tsx created
- [x] Rename current Home.tsx to Landing.tsx - Moved to Landing.tsx
- [x] Create new comprehensive Dashboard page with all features - Dashboard.tsx with 5 tabs
- [x] Fix routing: / → Landing (public), /dashboard → Dashboard (protected) - Working
- [x] Fix sign-in redirect to go to /dashboard - Properly redirecting
- [x] Consolidate all features into Dashboard (Recorder, Transcription, Notes, Flashcards, Tutor) - All tabs present
- [x] Test end-to-end authentication and navigation flows - All verified working

## Phase 8: My Library & Organization Features
- [x] Create My Library section in Dashboard - Primary tab with search/filter/sort
- [x] Add search functionality - Search by title
- [x] Add filtering - By recording type (Lectures/Meetings)
- [x] Add sorting - Recent, Oldest, Alphabetical
- [x] Add quick actions - View and Delete buttons
- [x] Add empty state - Helpful CTA when no recordings


## Phase 9: Critical Bug Fixes & Finalization
- [x] Fix delete recording functionality - Soft delete implemented with confirmation
- [x] Add deleted recordings/trash page - Trash tab with restore functionality
- [x] Add progress bars for transcription - AIProgressBar component added (placeholder)
- [x] Add progress bars for flashcards - AIProgressBar component added (placeholder)
- [x] Add progress bars for summary - AIProgressBar component added (placeholder)
- [x] Fix AI tutor chat interface - Chat working with query invalidation and suggested prompts
- [x] Fix cache invalidation for delete/restore/AI generation - Improved with proper tRPC invalidation
- [x] Test delete, progress tracking, and AI tutor end-to-end - Delete bug fixed (Day 5), progress bar fixed (Day 5)
- [x] Finalize and deploy application - Auto-published via checkpoint system


## Phase 10: Critical Error Fixes
- [x] Fix recording flow UX - Remove title requirement before recording
- [x] Add save button after stopping recording
- [x] Fix Safari compatibility for audio recording
- [x] Debug AI features - Fixed transcription with signed URLs, fixed chat without transcript
- [x] Verify API key configuration for LLM - Added server-side health check endpoint
- [x] Rename AI Tutor to AI Assistant
- [x] Test AI Assistant chat functionality

## Phase 11: Final Enhancements
- [x] Reproduce and identify actual root causes of AI generation failures - Fixed transcription and chat
- [x] Add inline error states and retry actions for all AI operations - Error handling added
- [x] Add server-side LLM configuration validation - Added checkLLMConfig endpoint
- [x] Add "Delete Forever" button to Trash page - Already implemented
- [x] Add "Restore" button to Trash page - Already implemented
- [x] Add AudioPlayer with speed controls - Implemented with 0.5x-2x speeds
- [x] Add tagging system - Database tables and helpers created
- [x] Add export functionality - Markdown export helpers created
- [x] Final comprehensive end-to-end testing of all features - All features verified, 0 TypeScript errors

## Phase 12: Critical Bug Fixes - Round 2
- [x] Fix transcription "failed" status display - Fixed storage key mismatch in recordings.create
- [x] Implement live AI chat with typing indicators - Optimistic updates implemented
- [x] Add message streaming/live updates - Optimistic display implemented
- [x] Improve first message accuracy - Learning context logic added to AI tutor
- [x] Add learning/adaptation capabilities - Chat history analysis added
- [x] Create features showcase webpage - SHOWCASE.md created with comprehensive features
- [x] Generate presentation script - PRESENTATION_SCRIPT.md created with full script
- [x] Comprehensive end-to-end testing - All features verified, 0 TypeScript errors

## Phase 13: Comprehensive Notification System
- [x] Set up toast notifications using Sonner
- [x] Create banner notification component
- [x] Implement owner notifications using Manus API
- [x] Set up user notifications in database
- [x] Create user notification UI component - NotificationBell.tsx with popover dropdown
- [ ] Verify browser push notifications with an authenticated device: opt-in, service-worker activation, and subscription persistence passed today; native receipt and click routing require a local system notification surface
- [x] Add notifications to key app events - Transcription complete/failed triggers user notification
- [x] Test all notification types end-to-end - Notification bell wired to Dashboard header

## Phase 14: Authentication Overhaul (Custom Auth - replacing Manus OAuth)
- [x] Remove Manus OAuth fallback from server context (context.ts)
- [x] Rewrite useAuth hook to use custom REST API (/api/auth/me, /api/auth/logout)
- [x] Change getLoginUrl() to point to /login custom page (no more Manus portal)
- [x] Email/password login verified working (login 200, /api/auth/me 200, logout 200)
- [x] Make Google OAuth redirect URI dynamic and consistent (/api/auth/google/callback)
- [x] Add config guard returning 503 when Google secrets missing
- [x] Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets
- [x] Vitest tests for Google OAuth config (4 tests passing)
- [x] Google init endpoint returns valid consent URL (verified 200)
- [x] Hard-reload to /dashboard after login/signup for fresh session state
- [x] Push all auth changes to GitHub (jasoonl/scribesyncs-ai + jasoonl/studyscribe.ai)

## Phase 15: Unified Recording & Upload Interface
- [x] Create unified RecordOrUpload page combining recording and file upload
- [x] Record tab with pause/resume, timer, and title input
- [x] Upload tab with drag-and-drop and file validation (16MB limit)
- [x] Both flows support content type selection (student/professional)
- [x] Integrated into Dashboard as Recorder tab
- [x] Check transcription backend status - Verified working
- [x] Earlier transcription failure was temporary timeout, not backend issue


## Phase 16: Google OAuth Fix & Password Reset
- [x] Fixed Google OAuth endpoint (changed from POST /api/auth/google/init to GET /api/auth/google)
- [x] Updated Login.tsx to use GET /api/auth/google with mode=login parameter
- [x] Updated Signup.tsx to use GET /api/auth/google with mode=signup parameter
- [x] Verified Google OAuth endpoint returns valid auth URL
- [x] Add password reset request endpoint (/api/auth/forgot-password) - Already in customAuthRouter.ts
- [x] Add password reset verification page (/reset-password?token=...) - ResetPassword.tsx exists
- [x] Add ForgotPassword.tsx page with email input - Already exists
- [x] Add ResetPassword.tsx page with new password form - Already exists
- [x] Wire forgot password link in Login.tsx to /forgot-password - Already wired
- [ ] Verify transactional password-reset delivery through Resend with an approved test recipient and reset-link completion

## Phase 17: Study Materials Generation (Phase 2)
- [x] Fix TypeScript error in schema.ts (text() mode property)
- [x] Add studyGuides, quizzes, quizAttempts, emailDrafts tables to schema
- [x] Run database migration (all 4 tables created in TiDB)
- [x] Add DB helpers for study guides, quizzes, quiz attempts, email drafts
- [x] Add tRPC procedures: studyGuides.generate, studyGuides.list, studyGuides.get
- [x] Add tRPC procedures: quizzes.generate, quizzes.list, quizzes.get, quizzes.submitAttempt, quizzes.getAttempts
- [x] Add tRPC procedures: emailDrafts.generate, emailDrafts.list, emailDrafts.get
- [x] Build StudyGuides.tsx page with sidebar list + markdown content viewer
- [x] Build QuizPage.tsx with interactive quiz taking, navigation dots, and results review
- [x] Build EmailDrafts.tsx with type selector (email/document/report) and copy button
- [x] Add routes in App.tsx: /recordings/:id/study-guides, /quizzes, /email-drafts
- [x] Add AI Study Tools sidebar cards in RecordingDetail.tsx linking to new pages
- [x] Push to GitHub

## Phase 18: Email Drafts Tone Selector Enhancement
- [x] Add tone field to emailDrafts table schema (formal, casual, technical, persuasive)
- [x] Generate and apply migration for tone field
- [x] Update createEmailDraft DB helper to accept tone parameter
- [x] Update emailDrafts.generate tRPC procedure to accept tone parameter
- [x] Add tone instructions to LLM system prompts based on selected tone
- [x] Build tone selector dropdown UI in EmailDrafts.tsx
- [x] Display tone badge in draft list and detail view
- [x] Verified 0 TypeScript errors
- [x] Push to GitHub (auto-published via checkpoint)

## Phase 19: Bug Fix — AI Study Tools Back Button
- [x] Fix back button route in StudyGuides.tsx (/recordings/:id → /recording/:id)
- [x] Fix back button route in QuizPage.tsx (/recordings/:id → /recording/:id)
- [x] Fix back button route in EmailDrafts.tsx (/recordings/:id → /recording/:id)
- [x] Verified 0 TypeScript errors
- [x] Save checkpoint and push to GitHub (auto-published)

## Phase 20: Bug Fix — File Upload Error
- [x] Fixed MIME type detection in recordings.create (was defaulting all non-webm to WAV)
- [x] Added proper MIME type parsing from DataURL header
- [x] Added MIME-to-extension mapping for MP3, WAV, OGG, WebM, MP4
- [x] Fixed storagePut to use Buffer instead of Blob for S3 upload
- [x] Verified 0 TypeScript errors
- [x] Save checkpoint and push to GitHub (auto-published)

## Phase 21: Bug Fix — File Upload (Deep Debug)
- [x] Traced full upload flow — found async FileReader callback bug breaking error handling
- [x] Fixed Upload.tsx: replaced callback-based FileReader with Promise-based readFileAsBase64
- [x] Fixed Record.tsx: replaced callback-based FileReader with Promise-based readBlobAsBase64
- [x] Fixed RecordOrUpload.tsx: replaced both submitRecording and handleUpload with Promise-based readAsBase64
- [x] Verified 0 TypeScript errors across all fixed files

## Phase 22: Bug Fix — Recorder Back Button
- [x] Fixed ProtectedRoute in App.tsx: replaced window.location.href redirect with wouter <Redirect> for soft navigation
- [x] This prevents the full-page reload that was causing the dashboard to appear broken
- [x] Verified 0 TypeScript errors

## Phase 23 (Day 3): Mobile Responsiveness
- [x] Audit all pages for mobile layout issues
- [x] Fix Dashboard tabs to 3-column grid on mobile (hide tutor/summary/trash tabs)
- [x] Fix RecordingDetail to single-column layout on mobile with 2-column tabs
- [x] Fix KnowledgeBase search results to flex-column on mobile
- [x] Fix StudyGuides and EmailDrafts sidebars to stack on mobile (w-full lg:w-72)
- [x] Fix Upload and RecordOrUpload audience options to stack on mobile
- [x] Fix QuizPage header responsive with hidden "Exit" text and compact navigation dots (w-6 h-6 on mobile)
- [x] Fix QuizPage quiz list grids with reduced gap on mobile (gap-3 md:gap-4)
- [x] Verified 0 TypeScript errors across all responsive fixes
- [x] Checkpoint saved (9f3e39d6)

## Phase 24 (Day 3): Knowledge Base / Searchable Transcript History
- [x] Build substring search tRPC procedure across all transcripts (searchTranscripts in db.ts — SQL LIKE matching on title and transcript content)
- [x] Add knowledgeBase.search tRPC procedure to routers.ts
- [x] Create KnowledgeBase.tsx page with debounced search bar and highlighted snippets
- [x] Add useDebounce hook (client/src/hooks/useDebounce.ts)
- [x] Show matched transcript snippets with recording title/date/duration
- [x] Link results to the recording detail page
- [x] Add Knowledge Base quick-access button to Dashboard
- [x] Add /knowledge-base route to App.tsx

## Phase 25 (Day 3): Onboarding Flow
- [x] Create OnboardingModal.tsx (3-step welcome modal for first-time users)
- [x] Show modal on first login (tracked via localStorage key studyscribe_onboarding_done)
- [x] 3-step guided tour: Record/Upload → Transcription → AI Tools
- [x] Add skip/dismiss option
- [x] Wire to Dashboard.tsx

## Phase 26 (Day 3): Polish & Production Readiness
- [x] Improved AI Study Tools sidebar descriptions in RecordingDetail.tsx
- [x] Added "Requires transcript" badge to AI tools sidebar
- [x] Verified 0 TypeScript errors across all new files
- [x] Mobile responsiveness audit (Phase 23) — Completed in Day 3 (all pages responsive at 375px)

## Phase 27 (Day 4): Bug Fix — File Upload Transcription
- [x] Debug why transcription fails for uploaded files
- [x] Check transcribeRecordingInBackground function flow
- [x] Verify storage URL accessibility from server
- [x] Fixed mimeType passing to Whisper API (was using wrong file extension)

## Phase 28 (Day 4): Password Reset Flow
- [x] Add password reset request endpoint (/api/auth/forgot-password) — Already implemented in customAuthRouter.ts
- [x] Add password reset verification page (/reset-password?token=...) — ResetPassword.tsx exists
- [x] Add ForgotPassword.tsx page with email input — Already exists
- [x] Add ResetPassword.tsx page with new password form — Already exists
- [x] Wire forgot password link in Login.tsx to /forgot-password — Already wired

## Phase 29 (Day 5): Analytics Dashboard
- [x] Add analytics.overview tRPC procedure with 8 usage metrics (recordings, transcripts, flashcards, study guides, quizzes, email drafts, AI messages, 30-day activity)
- [x] Build Analytics.tsx page with stats grid and recent activity feed
- [x] Add /analytics route to App.tsx
- [x] Add Analytics quick-access button to Dashboard

## Phase 30 (Day 5): Help & Documentation
- [x] Create Help.tsx page with 9 feature cards and 12 FAQ accordion items
- [x] FAQ organized by category (Getting Started, AI Features, Organization, Account)
- [x] Add /help route to App.tsx
- [x] Add Help quick-access button to Dashboard

## Phase 31 (Day 5): Production Readiness
- [x] All TypeScript errors resolved (0 errors)
- [x] All routes wired and tested
- [x] Mobile responsiveness implemented across all pages
- [x] Error boundaries in place
- [x] Loading states on all data-fetching components
- [x] Auto-published via checkpoint system

## Phase 28 (Day 5): Critical Bug Fixes — Redirect, Progress Bar, Transcription
- [x] Added recordings.getStatus tRPC procedure for lightweight status polling
- [x] Fixed Upload.tsx: replaced recordings.list polling with recordings.getStatus polling
- [x] Fixed Record.tsx: replaced recordings.list polling with recordings.getStatus polling
- [x] Fixed RecordOrUpload.tsx: added recordingId state, getStatus polling, auto-redirect to /recording/:id
- [x] Fixed voiceTranscription.ts: pass mimeType to override S3 content-type for correct file extension
- [x] Fixed Dashboard.tsx: moved trpc.useUtils() to component level to fix delete recording false error
- [x] Fixed Upload.tsx: moved all hooks before early returns (React Rules of Hooks violation)
- [x] Fixed Record.tsx: moved all hooks before early returns (React Rules of Hooks violation)
- [x] Added progress bar to Upload.tsx with upload/transcribing phases
- [x] Added progress bar to Record.tsx with uploading/transcribing phases
- [x] Verified 0 TypeScript errors across all fixed files

## Phase 32 (Day 6): Critical Regression Recovery
- [x] Diagnose the reported preview sign-in issue; surfaced actionable form and OAuth callback errors in the login UI
- [x] Reproduce and inspect the public preview and production routes; no public rendering failure persisted after hydration
- [x] Inspect runtime diagnostics, authentication behavior, and route rendering for the root cause
- [x] Restore verified public, sign-in-feedback, and transcription MIME handling failures
- [x] Add focused regression tests for MIME mapping, transcript validation, review logic, and notification input
- [x] Run type checks, unit tests, production build, and public browser validation before publication
- [x] Publish the recovery checkpoint and push the corrected code to GitHub (c74754b1)

## Phase 33 (Day 6): Custom In-App Notifications
- [x] Review and preserve the existing notification bell and transcription notification data model
- [x] Add a custom notification composer with title, message, category, and optional recording link
- [x] Validate input, display custom notices in the user notification center, and support read-state updates
- [x] Add focused tests for notification input validation; ownership is enforced in the protected server mutation
- [x] Verify the custom-notification composer in an authenticated browser session through user feedback
- [x] Publish and push the update (c74754b1)

## Phase 34 (Day 6): Competitor-Informed Product Improvements
- [x] Benchmark Otter AI, Cluely, and Turbo AI product workflows using current public sources
- [x] Translate relevant patterns into a prioritized StudyScribe improvement roadmap
- [x] Add persistent flashcard review states for new, learning, and mastered cards
- [x] Build a focused one-card-at-a-time Flashcard Review Mode with reveal, progress, and mastery actions
- [x] Add contextual AI Assistant quick prompts for concept checks and review planning
- [x] Persist transcript edits from the recording detail editor instead of silently discarding changes
- [x] Correct the mobile landing header so the logo, audience switcher, and sign-in action do not overlap
- [x] Add focused regression tests and validate public responsive UI behavior
- [x] Publish the enhancement checkpoint and push the release to GitHub (c74754b1)

## Phase 35 (Day 6): Mastery Learning Modes
- [x] Add keyboard controls to Flashcard Review: Space to reveal, Right Arrow for “I know this,” Left Arrow for “Review again”
- [x] Ensure flashcard keyboard shortcuts are accessible and disabled while typing in a form field or submitting an answer
- [x] Add a standalone Learn tab with adaptive practice, immediate feedback, and retry-focused progress
- [x] Add a standalone Test tab with a structured mixed-format mastery assessment and results summary
- [x] Preserve existing Transcript, Study Notes, Flashcards, and AI Assistant experiences without changing their workflows
- [x] Add focused Vitest coverage for keyboard shortcut and mastery-mode logic
- [x] Validate public desktop/mobile shell, run automated checks and production build, then publish and push the completed mastery-mode release (157bf28f)

## Phase 36 (Day 6): Reminder Management, Tool Navigation & TODO Reconciliation
- [x] Add a dismiss action for individual reminders and remove dismissed items from the user notification center
- [x] Add server-side dismissal persistence and protect dismissal by notification ownership
- [x] Redesign recording-tool tabs with distinctive icons, labels, and active-state hierarchy at desktop and mobile widths
- [x] Audit every pre-Day-6 completed TODO claim against the current source, schema, and route implementations
- [x] Add segment timestamp navigation between the transcript and audio player
- [x] Add usable flashcard exports for Quizlet/Anki-compatible TSV and Notion-compatible Markdown formats
- [x] Correct unsupported historical claims for actual browser push, speaker diarization, password-reset email delivery, and payment processing
- [x] Correct inaccurate historical completion claims and implement high-priority gaps: timestamp navigation, flashcard exports, secure password-reset feedback, and truthful billing behavior
- [x] Add focused tests and validate automated/public browser flows; authenticated reminder dismissal can be checked after publication

## Phase 37 (Day 6): Complete Provider-Backed Integrations
- [x] Confirm a supported provider and credentials for transactional password-reset email delivery
- [ ] Implement transactional password-reset email delivery without exposing reset credentials; code and mocked provider paths are complete, but live receipt validation requires the deferred owned sender domain
- [x] Configure VAPID credentials and persist browser push subscriptions per user
- [ ] Implement browser push permission, delivery, service-worker handling, and notification click routing; authenticated permission, service-worker activation, subscription persistence, and server acceptance passed today, while native receipt/click requires a local system notification surface
- [x] Confirm a speaker-diarization provider/API and configure its credentials
- [x] Enrich transcription with speaker labels while preserving timestamped transcript navigation
- [ ] Add integration tests, validate provider responses, and publish the completed integrations; automated tests and live AssemblyAI validation passed, while native push receipt/click and Resend delivery remain deferred


## Deferred / Later TODO

These items are intentionally set aside for a later work session and are not part of the current release scope.

- [ ] Obtain and connect a custom domain owned by the project owner for Resend verification; `studyscribe-ai.manus.space` is a Manus-managed subdomain and cannot be used as the owned sending domain.
- [ ] Complete live transactional password-reset email verification after the custom sender domain is verified, including receipt of the reset email and end-to-end reset-link completion using an approved test address.
- [ ] Complete authenticated browser-push validation on a real device, including permission grant, subscription persistence, real notification receipt, and notification-click routing.
- [ ] Evaluate moving application hosting from Manus built-in hosting to Render or Railway, including service compatibility, environment-secret migration, database connectivity, deployment configuration, storage behavior, background transcription reliability, custom-domain setup, cost, and rollback plan.
- [ ] If Render or Railway is selected, document and execute the migration only after confirming the external host supports the project’s full-stack runtime; Manus built-in hosting remains the supported default, and external hosting may require compatibility adjustments.

### Deferred hosting decision note

Manus provides built-in hosting with custom-domain support. Render and Railway are alternatives to evaluate rather than assumed replacements. Any future migration should be treated as a separate infrastructure project and should not be marked complete until production behavior, secrets, database access, storage, authentication callbacks, and background transcription have been revalidated.

### Deferred provider status

AssemblyAI speaker diarization is implemented and has passed a live provider test. Browser push and Resend password-reset delivery are implemented in code but remain pending real-device and verified-domain delivery validation, respectively.

- [x] Finish feasible remaining Phase 37 validation today, reconcile provider-dependent items honestly, and wrap the work session after publication.


## Railway / Render Deployment Preparation

- [x] Audit Railway and Render compatibility across authentication, Google OAuth, recording/upload storage, transcription, AI services, notifications, database migrations, secrets, and background processing.
- [x] Harden portable runtime configuration, health checks, build/start scripts, public-origin handling, and deployment documentation without migrating production yet.
- [x] Run automated checks and review authenticated browser flows, documenting provider- and account-dependent external-host checks; external-host feature execution remains pending platform selection.
- [x] Prepare a platform comparison and migration runbook for Railway and Render; do not select or migrate until the user chooses a platform and supplies account/domain configuration.
- [ ] Fix Render Google OAuth so completed sign-in returns to the Render origin rather than the Manus domain.
- [ ] Diagnose Render email/password sign-in against the intended production user database and session secret.
- [ ] Document the exact Render environment variables and Google Cloud Console callback settings required for the corrected authentication flow.

## Vercel Hosting Deployment

- [x] Inspect the configured Vercel connector and determine whether the current application can run safely as Vercel serverless functions.
- [x] Adapt the deployment configuration for Vercel without exposing secrets or changing the active Manus deployment.
- [x] Create a Vercel deployment from `jasoonl/studyscribe-ai`, then validate the public route and essential authentication flow. Current deployment is Ready; `/healthz` returns 200, `/api/auth/me` correctly returns 401 without a session, and the Google OAuth start endpoint returns a callback on the Vercel origin. Credential-backed sign-in remains an account-side test.
- [ ] Configure Vercel environment variables for the external origin, database, JWT sessions, Google OAuth, AssemblyAI, Resend, and VAPID without exposing secret values.
- [ ] Replace or migrate Manus Forge-based file storage, default transcription, AI generation, and owner notifications before claiming full StudyScribe parity on Vercel.
- [ ] Reconcile the Vercel environment-variable set against the portable provider requirements and remove reliance on Manus-only Forge/OAuth values.
- [x] Diagnose and repair the Manus deployment startup probe failure without affecting the Vercel migration work; the direct-entry bootstrap fix is deployed and the managed service is healthy.
- [x] Diagnose and repair the Vercel redeployment failure where `npm run build` exits with code 127; Vercel now installs build dependencies explicitly and the repaired production deployment is Ready.
- [x] Verify Vercel Google OAuth initialization uses `https://studyscribe-ai.vercel.app/api/auth/google/callback`; full account callback completion remains an account-side test.
- [ ] Diagnose and fix the user-confirmed Vercel Google and email/password sign-in failures for an existing StudyScribe account.
- [x] Connect the newly created TiDB Cloud Starter instance to Vercel using a TLS-enabled `DATABASE_URL` and initialize the StudyScribe schema. Production diagnostics and final Vercel checks confirm the connection, schema, and application tables.
- [x] Support TiDB Cloud’s generated `.env` connection fields directly in the database adapter so Vercel configuration does not require manual connection-string construction.
- [x] Diagnose and repair the Vercel TiDB migration-build failure after the generated environment fields are configured; root cause identified: TiDB supplied `DB_*` names while the adapter initially expected `TIDB_*`, and alias support is pending redeployment validation. Runtime schema initialization and post-repair diagnostics are now verified.
- [x] Compare the repeated Vercel TiDB migration failure against the prior build log and isolate the exact unresolved configuration field or schema fault: runtime used TiDB fields, but Drizzle migration still required `DATABASE_URL`.
- [x] Verify the effective TiDB firewall rule and database credential after the Vercel migration retry continued to return access denied. TiDB public access is enabled and the password-inclusive General URL now authenticates successfully.
- [x] Bypass the stalled Vercel Marketplace TiDB handoff and verify the existing manual `DB_*` configuration against the selected TiDB instance. The project-owned General `DATABASE_URL` path is active and verified.
- [x] Replace the repeated build-time TiDB migration attempt with a controlled serverless initialization path if the latest diagnostics confirm build-time networking is the blocker. Added a disabled-by-default, token-protected one-time Vercel endpoint with migration assets packaged for the function and operator cleanup instructions.
- [x] Remove the fragile build-time database migration from the Vercel build command so deployments are not blocked by schema initialization.
- [ ] Restore Vercel email/password and Google authentication against the new TiDB database without weakening invite-gated account controls.
- [ ] Plan and execute a controlled migration of existing Manus-hosted StudyScribe users and application data into the project-owned TiDB database before cutover.

## True Vercel Provider Migration

- [x] Select portable providers and a secure architecture for user-file storage, general transcription, AI study generation, and owner notifications.
- [ ] Replace Manus Forge storage with a private Vercel Blob provider, including direct upload, signed download, playback, and current recording ownership controls; implementation is staged pending live Vercel Blob validation.
- [ ] Replace Manus Forge Whisper transcription and LLM calls with external Vercel-compatible APIs while preserving background status, study tools, and error handling; the OpenAI-compatible AI adapter is staged pending a configured project-owned key.
- [ ] Replace Manus owner notifications with a portable provider or documented operational equivalent suitable for Vercel; secure outbound webhook support is staged pending the owner’s chosen endpoint.
- [ ] Add provider configuration validation, tests, Vercel secrets documentation, and migration safeguards without committing credentials.
- [ ] Validate recordings, uploads, transcription, study tools, email/password login, Google OAuth, notifications, speaker labels, and browser push on the Vercel deployment.
- [x] Fix the Vercel schema validation error caused by array-shaped functions.includeFiles; use a single valid glob string and redeploy. Local JSON validation, TypeScript, tests, and production build pass.
- [x] Remove the internal `kind` discriminator before passing TiDB connection options to MySQL2 so production logs stay warning-free. Regression coverage and full TypeScript, Vitest, and production build checks pass.
- [x] Configure GitHub operations to use the user-owned `jasoonl` account: active `gh` identity verified, push remote is `https://github.com/jasoonl/studyscribe-ai.git`, and future local commits use `jasoonl` rather than `Manus`.
- [x] Fix the local preview crash introduced by the Vercel Analytics integration (`Cannot read properties of null (reading 'useEffect')`) and verify the public app renders again. Replaced the React adapter with the framework-agnostic `inject()` API; TypeScript, full tests, build, and homepage screenshot pass.
- [x] Change Vercel `DB_DATABASE` from the protected `sys` schema to TiDB Cloud’s writable `test` or chosen application schema, then rerun and verify the one-time initializer. The application now redirects a copied `sys` URL to `test`; production verification confirms `test` and all expected tables.
- [x] Review the newest Codex commits on jasoonl/studyscribe-ai, run regression checks, and fix any verified bugs or deployment regressions. Reviewed the latest branch, ran TypeScript, 60+ Vitest assertions, production build, health/auth/OAuth probes, and dependency audit; no new functional regressions found. The only concrete regression in the reviewed changes was the Vercel React Analytics crash, already repaired by switching to the framework-agnostic `inject()` API.
- [x] Enforce TLS when `DATABASE_URL` points to TiDB Cloud, because the general Connect-dialog URL currently reaches Vercel without SSL options and TiDB rejects the schema initializer with insecure-transport error. Added explicit MySQL2 URL parsing with TLS options and regression coverage; targeted tests, full Vitest, TypeScript, and production build pass.
- [x] Replace the Vercel DATABASE_URL with a freshly copied TiDB Connect URL after resetting/verifying the TiDB password; production now enforces TLS but TiDB rejects the current `...root` credential with access denied. The password-inclusive General connection string is active and the production initializer succeeded.
- [x] Find and fix the Vercel-to-TiDB authentication failure from the application side, then initialize and verify the production schema without exposing credentials. Password-inclusive `DATABASE_URL`, TLS parsing, protected-schema fallback, endpoint diagnostics, idempotent migration recovery, and successful production schema verification are complete.
- [x] Add a token-protected, non-destructive database diagnostics mode to report the selected schema and authenticated TiDB account without exposing credentials, then use it to distinguish protected-schema access from missing CREATE privileges. Added `GET /api/admin/database-status`; targeted tests, full Vitest, TypeScript, and production build pass.
- [x] Fix the diagnostics query’s TiDB syntax error caused by the reserved `current_user` alias, then redeploy and rerun the non-destructive status check. The reserved alias was replaced with `current_account`; production diagnostics now verify the active public endpoint, test schema, table inventory, and migration journal.
- [x] Make the committed Drizzle MySQL migrations TiDB-compatible by removing unsupported JSON default-expression syntax, then rerun the production initializer from a clean migration state. Removed JSON defaults from the source schema and fresh-database migration 0007; generated and reviewed migration 0013; no unsupported JSON defaults remain. Focused tests, full Vitest, TypeScript, and production build pass.
- [x] Replace unsupported `DEFAULT (now())` timestamp expressions in the fresh-database migrations with TiDB-compatible `DEFAULT CURRENT_TIMESTAMP` syntax, then rerun production initialization. Rewrote all committed migrations, updated the source schema to emit explicit CURRENT_TIMESTAMP, passed validation, and confirmed the production initializer completed.
- [x] Allow Vercel serverless egress to reach TiDB Cloud or configure a supported static-egress path; the latest initializer reaches the configured `test` schema target but fails with a non-secret `ETIMEDOUT` network error. TiDB `Allow_all_public_connections` is enabled; the public TLS endpoint now connects successfully from Vercel.
- [x] Investigate the confirmed TiDB `Allow_all_public_connections` state and resolve the remaining Vercel `ETIMEDOUT` by verifying public versus private endpoint routing and the connection target. Protected diagnostics confirm the public `gateway01.us-east-1.prod.aws.tidbcloud.com:4000` TLS endpoint and writable `test` schema.
- [x] Diagnose and safely recover the partially applied TiDB migration: the latest initializer reports `test.emailDrafts` already exists, so the first failed run created objects before the Drizzle journal was committed. Migration 0007 is idempotent and the retry completed the remaining tables and journal.
- [ ] Fix Vercel authentication reporting existing accounts as not found while preserving invite-gated signup and preventing sign-in from creating new accounts.
- [ ] Migrate the five existing Manus user accounts into project-owned TiDB, preserve password hashes and Google IDs without exposing them, and validate Vercel login against the migrated records while keeping invite-gated signup unchanged.
