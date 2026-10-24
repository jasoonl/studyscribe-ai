# Study sources: frontend plan

Status: PLAN. Branch `claude/phase8-study-sources`. Backend counterpart: `docs/plans/study-sources-backend.md`. Owner chose study sources as the Phase 8 priority; add a "Phase 8: Study sources" entry to the roadmap.

## 1. What the student gets

1. Per course, upload PDFs, slides, text/Word files, or paste notes.
2. Each source is read, summarized, and broken into main ideas and details, with likely test material flagged.
3. The tutor chat ("Ask") can be pointed at chosen sources and answers with citations that open the source at the right page or slide.

Reuse, do not rebuild: `AIChatBox` (`renderMessageExtra`), the `SourceChips` citation pattern in `Ask.tsx`, `CourseDot`, `Markdown`, `Tabs`, `Sheet`, `Progress`, `Skeleton`, `pressable()`, `fetchWithRetry`.

## 2. Routes (App.tsx)

| Path | Page | Notes |
|---|---|---|
| `/courses/:id/sources` | `SourceLibrary` | list and upload for one course |
| `/sources/:id` | `SourceDetail` | query: `page=<n>`, `q=<passage id>`, `tab=` |
| `/ask?course=<id>&source=<id>,<id>&mode=` | existing `Ask` | `source` preselects the picker |

Both new pages are `React.lazy` and wrapped in `ProtectedRoute`. Put the longer course path before `/courses/:id` in the `Switch` and verify in the browser. Entry point: a "Sources" button in the `CoursePage` header and a section listing the 3 newest sources with "See all". Add the paths to the noindex set in `shared/seo.ts` if it lists private routes. Sources are not kept offline in this slice.

## 3. Files

New:
- `client/src/pages/SourceLibrary.tsx`, `SourceDetail.tsx`
- `client/src/components/sources/`: `SourceUploader`, `SourceUploadRow`, `SourceCard`, `SourceStatusBadge`, `PasteNotesDialog`, `MainIdeasList`, `KeyPointsList`, `PassageViewer`, `SourcePicker`, `CitationChips`
- `client/src/hooks/useSourceUploads.ts` (queue, concurrency 2, abort, progress), `useSourcePolling.ts`
- `client/src/lib/sourceUpload.ts` (+ test), `sourceLocation.ts` (+ test): `formatLocation`, `sourceHref`
- Constants come from the backend's `shared/sources.ts` (single source of truth for accepted types and caps).

Edited: `App.tsx`, `CoursePage.tsx`, `Ask.tsx`, and all six `shared/i18n/*.ts` files. Do not touch `AIChatBox.tsx` unless `[n]` markers must become links; prefer chips under the bubble via `renderMessageExtra`. Do not change `directAudioUpload.ts` (mobile and extension depend on it).

## 4. Upload UX

Accepted types and caps are read from the shared constant, never hard-coded in the UI.

Per file (`useSourceUploads`):
1. Client check of type and size; show an inline row error, not a toast.
2. `sources.prepareUpload` returns a presigned URL; PUT it with `XMLHttpRequest` for real progress and `AbortSignal` support (`uploadSourceDirectly`, modeled on `uploadAudioDirectly`).
3. `sources.create` with the stored key; the row switches from "Uploading 63%" to the server status.
4. Stages: Uploading, Queued, Reading, Summarizing, Ready. Failure shows a reason with Retry or Remove.

Interaction: the drop zone is a labelled button around a hidden multi-file input (click, Enter, Space work; drag is an enhancement). Two uploads at a time; the rest read "Waiting". `beforeunload` guard only while uploading. Plan limits reuse `client/src/lib/usageLimit.ts` and also show inline.

Polling: one `sources.list` query per course, `refetchInterval` 3000 ms while any row is queued, reading or summarizing, otherwise off. Give up after 15 minutes with "This is taking longer than usual" and Retry. The detail page polls `sources.getStatus` and refetches `sources.get` once when it turns ready. (Every page showing a processing item must keep polling, per CLAUDE.md.)

## 5. Source detail (`/sources/:id`)

Header: back link, title with a rename dialog, type, page count, date. Actions: Ask about this source, Open original (short-lived signed link), Delete (AlertDialog).

Tabs (URL-synced):
1. **Summary**: Markdown summary, then main ideas, each with a location chip ("Page 4", "Slides 7 to 9") linking to `?page=N`.
2. **Likely on a test**: key points with a visible `ToggleGroup` "All details | Likely on a test", count via `tn`, a text badge (never colour alone) and a reason line.
3. **Pages** or **Slides**: `PassageViewer` with a page list (desktop) or `Select` (375), Previous/Next labelled with the target page, and `?page=N&q=<id>` scrolling to the passage, focusing its heading, and highlighting with `<mark>`.

Known limit: following a citation leaves `/ask` and the local conversation is lost on Back. Ctrl/Cmd-click opens a new tab (native links).

## 6. Tutor grounding (`Ask.tsx`)

- `SourcePicker` next to the course select: trigger reads "All sources in course", "3 sources" or "Recordings only". Popover on desktop, bottom `Sheet` below `sm`. Checkbox list, Select all / Clear, and a mode choice: Sources and recordings (default), Sources only, Recordings only.
- Hidden hint "Choose a course to use its sources" with no course; a link to the sources page when a course has none ready.
- Selection lives in the URL, not localStorage (no new cookie or storage key).
- Sending: with sources use `ai.askSources`; otherwise the existing `ai.askAcrossRecordings`.
- `CitationChips`: same look as `SourceChips`; real `<a>` links with full-phrase `aria-label`s and the snippet as `title`. "Looked through N sources and M recordings."
- No passage matched: "No passage in your sources matched. The answer is not based on them." and the server makes no LLM call.
- Footer: "Check the linked page before relying on an answer."

## 7. States

| Screen | Loading | Empty | Error |
|---|---|---|---|
| SourceLibrary | 3 skeleton rows | dashed panel with visible upload button | inline alert with Retry; drop zone stays |
| SourceCard processing | status badge and indeterminate progress | | reason plus Retry/Remove |
| SourceDetail | skeleton header and panel | "No summary was produced." with Regenerate; "Nothing was flagged. Switch to All details." | not found like `CoursePage`; processing and failed banners |
| SourcePicker | skeleton rows | link to sources page | "Could not load sources" with Retry |

Scanned or image-only PDFs: show "This file has no readable text. Try a text version or paste the notes." Never a blank summary.

## 8. Accessibility

One `h1` and `<main id="main-content">` per page. Progress bars have `role="progressbar"` and labels; one polite live region per page announces "{name} is ready"; errors use `role="alert"`. Filter group works with arrow keys and announces the new count. Picker traps focus, Escape closes, focus returns to the trigger. Icon-only buttons are labelled. Motion respects reduced-motion. axe clean at 1280 and 375.

## 9. Mobile at 375

16px gutters, no horizontal scroll, 44px upload target, cards stack, header actions collapse into a "More actions" menu except the primary action, tabs scroll inside their own list, picker is a bottom sheet with a sticky Done button and safe-area padding, chips wrap and truncate.

## 10. House design rules

No gradients, glassmorphism or emoji; one icon per idea; no em dashes in copy; no hover-only buttons; semantic tokens only; plain wording (no "AI-powered", "unlock", "seamless"); dates and numbers through `formatDate`/`formatNumber`.

## 11. Internationalization

Every string goes through `t()`, `tn()` or `<Trans>` and is added to `en`, `es`, `fr`, `zh`, `ja`, `ko` in the same change. `{placeholders}` and `<tag>` links must survive; `server/i18n.test.ts` checks this. Plural pairs use `_one`/`_other`. Add keys only; never reword existing ones. Server error text stays English and known codes (`needsOcr`, `tooLarge`, `unsupportedType`, `limitReached`, `failed`) map to client keys.

Key groups (about 110 keys): `sources.title`/`subtitle`/`seeAll`, `sources.upload.*`, `sources.paste.*`, `sources.status.*`, `sources.kind.*`, `sources.meta.*`, `sources.empty.*`, `sources.error.*` (including `notSetUp`), `sources.detail.*`, `sources.ideas.*`, `sources.points.*`, `sources.location.*`, `sources.picker.*`, `ask.sources.*`, `course.sources`.

## 12. API needed from the backend (reconcile with the backend plan)

```ts
type SourceStatus = "queued" | "reading" | "summarizing" | "ready" | "failed";
type SourceKind = "pdf" | "slides" | "doc" | "notes";
type Location = { kind: "page" | "slide" | "section"; start: number; end?: number; label?: string };
type SourceListItem = {
  id: number; courseId: number; title: string; kind: SourceKind;
  status: SourceStatus; failureCode?: "needsOcr" | "unsupported" | "tooLarge" | "failed";
  pageCount: number | null; byteSize: number; createdAt: string; testPointCount: number;
};
```

All `protectedProcedure`:
1. `sources.list({ courseId })` returns `SourceListItem[]`
2. `sources.get({ id })` returns the item plus `summary` (Markdown), `mainIdeas[{id,text,location}]`, `keyPoints[{id,text,testRelevant,reason,location}]`, `originalAvailable`
3. `sources.getStatus({ id })` (cheap, for polling)
4. `sources.prepareUpload({ courseId, fileName, mimeType, size })` returns `{ enabled, upload:{ key, uploadUrl, uploadContentType } }` (own procedure; the audio-only endpoint is not reused)
5. `sources.create({ courseId, title, fileKey, mimeType, size })` and `sources.createFromText({ courseId, title, text })`
6. `sources.retry`, `rename`, `delete`, `regenerateSummary`
7. `sources.passages({ id, page?, cursor? })`, paged so a 300-page PDF is not one response
8. `sources.fileUrl({ id })`, a short-lived signed link, access checked at issue time
9. `ai.askSources({ question, courseId, sourceIds?, includeRecordings?, history })` returns `answer`, `citations[{ n, type, sourceId?, recordingId?, title, location, start, passageId?, snippet }]`, `searchedSources`, `searchedRecordings`
10. Errors: `FORBIDDEN` with `usageLimit` for plan limits; failures only as the `failureCode` enum, never raw provider text.
11. Missing tables: `list` returns `[]`, mutations explain "Study sources are not set up on this server yet" (pattern from `bookmarks.ts`).

The backend owns the shared constants `SOURCE_ACCEPT`, `SOURCE_MAX_BYTES`, `SOURCE_MAX_PER_COURSE`, `SOURCE_NOTES_MAX_CHARS`.

## 13. Build order

1. Shared constants, i18n keys (en first, then five languages), `sourceLocation` helpers and tests.
2. `sourceUpload.ts`, `useSourceUploads`, tests (progress, abort, retry).
3. `SourceLibrary`, uploader, cards, polling; routes and CoursePage entry.
4. `SourceDetail` and its components.
5. `SourcePicker`, `CitationChips`, `Ask.tsx`.
6. Playwright pass, then `npm run check`, `npm test`, `npm run build`.

Unit tests: `formatLocation`, `sourceHref`, upload queue concurrency and abort, status-to-poll-interval, i18n placeholder test over the new keys.

## 14. Playwright plan (1440x900 and 375x812)

Log in once and reuse `storageState`; use the mock services from CLAUDE.md or seed `sources` rows directly. At each width check: empty and uploaded library (no horizontal scroll), failed uploads show inline errors with a focusable Retry, drag-drop and keyboard upload, detail tabs and the test filter, citation deep link lands on the highlighted passage with focus on its heading, picker as popover (1440) and bottom sheet (375), `ja` and `es` for overflow, axe with zero violations, clean console, polling stops after Ready. Screenshots go to the scratchpad, not the repo.

## 15. Risks and open decisions

- File types and the PPTX extraction path are backend decisions; the UI needs only `kind` and `Location`.
- No in-browser PDF preview (extracted text plus "Open original").
- The Ask conversation is not persisted across a citation click.
- Mobile app parity is a separate item.
- Translations are not reviewed by native speakers.
