# Study sources: iPhone app plan

Branch `claude/phase8-mobile-sources`. Mirrors the web (`study-sources-backend.md` section 0 decisions win; `study-sources-frontend.md` for UX). English only (the app has no i18n). **No server change, no new native dependency**: `expo-document-picker` and `expo-file-system` (`File.upload` native task, `File.open/readBytes`) are already installed; `expo-secure-store` stays for the session only. **No purchases, prices or upgrade links** (STORE.md, 3.1.3(f)): a usage-limit refusal says "You have reached this month's allowance. It resets on the first of the month." and nothing else (same as the Plan screen's neutral line); never the web's "See plans" toast.

## 1. Reuse vs new

Mobile Metro only watches `shared/`, not `client/`. The pipeline logic is plain TS but lives in `client/src/lib`, so it cannot be imported. Decision: **copy the pure parts into `mobile/src/lib/sources/`** (header comment "mirrors client/src/lib/X.ts; keep in step", the way `upload.ts` mirrors `@vercel/blob`) rather than moving files under `shared/` (that would touch web files mid-branch). Copy as is, minus `@/` imports and i18n keys:

| New mobile file | Copied from | Notes |
|---|---|---|
| `model.ts` | `sourceModel.ts` | `stageOf`, `summaryPercent`, `failureReasonOf`, `isRetryableReason`, `isLikelyOnTest`, `filterFlags`, types. `SOURCE_LIMITS` from `@shared/const`. Drop `kindLabelKey`; add `kindLabel(kind)` ("PDF", "Slides", "Document", "Notes") and `failureText(reason)` (plain English sentences, one per `FailureReason`). |
| `location.ts` | `sourceLocation.ts` | `parseLocation`, `sourceHref`, `unitFromPageParam`, `findQuote`; `formatLocation(label)` returns English directly ("Slide 7: Title"). |
| `pipeline.ts` | `sourceUpload.ts` (pipeline, `mapPool`, `remainingParts`, `isStalled`, `pollIntervalFor`, `UploadAbortedError`) + `sourceUploadQueue.ts` | Drop XHR `putWithProgress` and `File` helpers. `validateSourceFile`/`fileExtension` take `{ name, size }`. |
| `askSources.ts` | `askSources.ts` | `AskMode`, `AskSourceSelection`, `askRequestOptions`, `pickerLabel`, `quoteFromSnippet`, `citationLink`. Drop URL parsing; add `emptySelection`. |

Imported straight from `@shared/*`: `const.ts` (`MAX_SOURCE_BYTES`, `MAX_SOURCE_TEXT_BYTES`, `SOURCE_EXTENSIONS`, `MAX_SOURCES_PER_COURSE`, `MAX_SOURCES_PER_USER`, `sourceKindForFileName`). Check that file has no server imports (it is already used by the app for recording caps). `import type { AppRouter }` already covers every `sources.*` type; use `inferRouterOutputs` for `SourceListItem`, `SourceDetail`.

New (mobile-only): `notes.ts` (pasted notes to a `.txt` in the document directory, name sanitised like `notesToFile`), `uploadStore.ts` (persisted job journal), `UploadsProvider.tsx`, `pickSources.ts`, `errors.ts`.

## 2. Screens, routes, exact file list

Routes reuse web paths (CLAUDE.md rule), so universal links work.

- `src/app/(app)/courses/[id]/sources.tsx` is **not** possible next to `courses/[id].tsx` (file vs folder clash). Moving `[id].tsx` to `[id]/index.tsx` touches an existing file; instead use `src/app/(app)/course-sources/[id].tsx` and map `/courses/:id/sources` to it in `links.ts`. App route: `/course-sources/:id`.
- `src/app/(app)/sources/[id].tsx` is the detail (`/sources/:id?tab=&page=&q=`).
- `src/app/(app)/_layout.tsx` gets two `Stack.Screen` lines (`course-sources/[id]` title "Study sources", `sources/[id]` title "").

Library (`course-sources/[id].tsx`, Lane 1): `Screen` with course name, "Add" button row (Add a file, Paste notes), `UploadRows` for in-flight jobs on top, then `SourceRow` cards (title, kind badge, size, stage, "N likely test points", progress bar while working, red reason line plus Retry/Delete when failed, "Continue" when `isStalled`). Tap a ready row opens `/sources/:id`; a working row opens the same screen, which shows progress. Swipe-free: Delete and Rename live in a row "More" action sheet (`Alert.alert` actions, 44pt button). Sorted newest first, grouped by nothing. Empty state explains the formats and the 25MB cap. Pull to refresh invalidates `sources.list`.

Course entry (`courses/[id].tsx`, Lane 1, small edit): a `SourcesCard` row under the exam-pack button ("Study sources, 3 ready", chevron) pushing `/course-sources/:id`. Rendered only when `sources.list({courseId}).data.available`. Add a second entry on the dashboard? No; v1 is course-scoped only.

Upload entry (in the library, `AddSourceSheet.tsx`): `Sheet` with two actions. "Choose a file" calls `DocumentPicker.getDocumentAsync({ type: [pdf, openxml pptx, openxml docx, "text/plain", "text/markdown", "application/octet-stream"], copyToCacheDirectory: true, multiple: true })`; iOS reports `.md` loosely, so `*/*` is not used but the extension check (`validateSourceFile`, same legacy-type and 25MB/2MB text caps as web, `.doc`/`.ppt` get "Save it as .docx / .pptx first") is the real gate. "Paste notes" shows title + multiline `Input` (min 20 chars), writes `<title>.txt` via `expo-file-system`, and enqueues it like a file.

Detail (`sources/[id].tsx`, Lane 2): header title and kind; `Segmented` with Summary / Likely on a test / Pages (stored in route param `tab`, default summary; if `page` is present open Pages). Summary: `Markdown` of `summary` (reuse `Markdown.tsx`), while not ready a `ProcessingCard` with stage and `partsDone/partCount`. Likely on a test: flags via `filterFlags(flags, "test")` with a "Show all details" toggle; each `FlagCard` shows kind badge, text, location chip (`formatLocation`) and quote, tap opens Pages at that unit. Pages: unit list (`units[]` labels, 1-based number) then a reader: `sources.getUnit` text in a selectable `Text`, Previous/Next buttons, `page` param drives selection (`unitFromPageParam`), `q` highlights via `findQuote` (nested `Text` with `bg-secondary`), scrolled into view. No "Open original" (decision 5). Failed state shows `failureText`, Retry only if `isRetryableReason`. Poll `sources.get` every 3s (`useProcessingPoller` pattern) while working and no provider job owns it.

New files: Lane 1: `src/lib/sources/{model,location,pipeline,askSources,notes,errors,uploadStore,pickSources}.ts`, `src/lib/sources/UploadsProvider.tsx`, `src/lib/sources/useSourcesAvailable.ts`, `src/components/sources/{SourceRow,UploadRows,AddSourceSheet,SourcesCard,SourceProgress}.tsx`, `src/app/(app)/course-sources/[id].tsx`; edits: `src/app/_layout.tsx` (mount provider), `(app)/_layout.tsx`, `(app)/courses/[id].tsx`, `src/lib/links.ts`. Lane 2: `src/app/(app)/sources/[id].tsx`, `src/components/sources/{SourceSummaryTab,LikelyOnTestTab,PagesTab,FlagCard,UnitReader,AskSourcePicker,SourceCitations}.tsx`, edit `(app)/(tabs)/ask.tsx`.

## 3. Upload and analysis pipeline (iOS)

`UploadsProvider` mounts above the navigator next to `RecorderProvider` (`src/app/_layout.tsx`, inside the tRPC/Session providers, so `trpc.useUtils().client` and the token are available). It owns a queue (concurrency 2, copied `createUploadQueue`), one `AbortController` per job and a `Job` list. Steps per job, all server-checked by ownership:

1. `validateSourceFile` (before any network). 2. `sources.prepareUpload({ fileName, size, courseId })`. 3. Single PUT (files are at most 25MB, so no multipart): `new File(uri).upload(uploadUrl, { httpMethod: "PUT", uploadType: BINARY_CONTENT, headers: { "Content-Type": uploadContentType }, onProgress })`, exactly as `nativeUploadIo.putFile`; progress is bytes/size. Treat non-2xx as "The upload was refused (status)". 4. `sources.register({ key, fileName, courseId })` -> `id`. 5. `runSourcePipeline(api, id, { signal, resume })`: `extract` (if the response is still `extracting`, wait up to 60s via `sources.get`, like web's `SourceStillReadingError`), `analyzePart` x n with 2 in flight, `finalize`. 6. Invalidate `sources.list`/`sources.get`; remove a done row after 6s.

Cancel: `Cancel` on a row aborts the signal (JS-side steps stop between calls; the native task is cancelled with `File.upload`'s returned task if the installed expo-file-system exposes it, otherwise the PUT finishes unregistered and the orphan blob is acceptable because it never reaches `register`). After `register`, "Remove" calls `sources.remove`.

Persistence: `uploadStore.ts` writes `source-uploads.json` in the document directory (same pattern as the recorder journal; not SecureStore) with `{ rowId, uri, name, size, courseId, key?, sourceId?, stage }` after each transition. The picked file is first copied from cache into `documentDirectory/source-uploads/` so iOS cannot purge it. On launch the provider loads the journal: a job with `sourceId` resumes via `sources.get` -> `runSourcePipeline` with `resume` (server holds part progress; `analyzePart` is idempotent by input hash); a job with only `key` (PUT done, not registered) calls `register` directly (keys are valid until the Blob lifecycle expires them; on failure fall back to a fresh `prepareUpload` and PUT); a job with neither restarts from `prepareUpload`. Resumed jobs show "Continuing" and are not started silently when `Settings` data saver is off-line: they start when `NetInfo`-free check passes (first request failing marks the row "Waiting for a connection" with a Retry; no new dependency).

Backgrounding: the native PUT keeps going while the app is backgrounded (as the recording upload does). The JS pipeline steps (`extract`, `analyzePart`, `finalize`) are ordinary fetches and iOS suspends them shortly after backgrounding; no background task is added. Handling: an `AppState` listener aborts nothing, but on `active` it calls `resumeAll()` which re-runs any job whose stage is mid-pipeline (idempotent server steps make this safe). A source left mid-pipeline when the app is killed shows "Continue" (`isStalled`, 2 minutes) in the library and detail and is also resumed from the journal at launch. Mid-flight analysis uses the 60s function budget per call exactly as on web; each `analyzePart` is its own request.

Errors (`errors.ts`, copy of `describeError`): `usageLimitOf` equivalent = `error.data?.usageLimit` on `TRPCClientError` -> `usageLimit` (plain sentence above, no link); `TOO_MANY_REQUESTS` -> "You are going a little fast. Try again in a minute." (job stays resumable, Retry); message `/not set up on this server/` -> hide (see 6); `SourceFailedError`/server sentence -> `failureReasonOf` -> `failureText`; `BAD_REQUEST` cap sentences ("keep up to 25 sources in a course") shown as the server wrote them; `UNAUTHORIZED` is handled by the existing session code; network errors map to "Can't reach StudyScribe" (`errorMessage`), job paused with Retry. Failed reasons are never shown raw.

## 4. Ask tab (Lane 2, edit `ask.tsx` only)

- `useSourcesAvailable()` (Lane 1) -> `{ available, count }`. If not available or `count === 0`, `ask.tsx` renders and sends **exactly as today** (no new input fields, no picker), so people with no sources see no change.
- Otherwise a "Using" chip beside the course chips opens `AskSourcePicker` (`Sheet`): a three-way `Segmented` (Both, Sources only, Recordings only), then a checklist of ready sources for the chosen course (or all) with 44pt rows, "Select all"/"Clear". State is `AskSourceSelection`, kept in `useState`, not in the URL. The chip text comes from `pickerLabel`.
- Request: `ask.mutateAsync({ question, courseId, history, ...askRequestOptions(selection) })` only when sources exist; defaults (`both`, no ids) send `includeSources: true, includeRecordings: true` which equals current behaviour.
- Citations: `Citation` gains `sourceId?`, `location?`, `unitIndex?`. `SourceCitations` renders sources chips (document icon, `[n] Title, Slide 7`) and keeps the recording chip unchanged. A source chip pushes `citationLink(citation)` through `router.push` -> `/sources/:id?tab=pages&page=N&q=...`. Accessibility label "Source n: Title, Slide 7".
- Empty-state copy gains "or your uploaded notes" only when sources exist.

## 5. Links (`src/lib/links.ts`, Lane 1)

Add to `APP_ROUTES`: `/^\/sources\/\d+$/` and `/^\/courses\/\d+\/sources$/`. Keep query keys `tab`, `page`, `q` for `/sources/:id` (extend the allow-list per route, since the current list is global: add `["t","token","invite","code","email","tab","page","q"]` only when the path starts with `/sources/`). Rewrite `/courses/:id/sources` to `/course-sources/:id`. Cap `q` at 120 chars, `tab` must be one of `summary|points|pages`, `page` digits only. Update the links test. Universal-link `.well-known` AASA needs `/sources/*` and `/courses/*/sources` paths: note for the owner (placeholders already exist).

## 6. Availability

`useSourcesAvailable` calls `sources.list()` once (`staleTime` 60s, `retry: false`); `available === false`, a `PRECONDITION_FAILED` "not set up" error, or any error returns `{ available: false }`. Then: no `SourcesCard`, library route shows `EmptyState` "Study sources are not available yet" if opened by a link, Ask is untouched, and the provider does nothing. While loading, the card is not rendered (no layout jump: it appears with `LayoutAnimation` off under Reduce Motion).

## 7. Accessibility, motion, safe areas, theme

All buttons have `accessibilityLabel`/role; rows are one `Pressable` with a combined label ("Biology slides, PowerPoint, ready, 4 likely test points"); progress is `accessibilityRole="progressbar"` with `accessibilityValue` and announced stage changes via `AccessibilityInfo.announceForAccessibility` (throttled: stage changes only). Targets at least 44pt (`min-h-[44px]`); chips that are 34pt in Ask get `hitSlop`. Text uses the `Text` variants (no fixed heights; `numberOfLines` plus tap to expand for flag text) so Dynamic Type up to accessibility sizes wraps; the reader uses `allowFontScaling` and no horizontal scroll. Use `useReducedMotion` for progress animations and the sheet (already handled in `Sheet`). `Screen`/`SafeAreaView` handle insets (`edges={["bottom"]}` under native headers as in `courses/[id].tsx`); no absolute-positioned footers. Colours only from `useTheme()` tokens and NativeWind classes (`bg-card`, `text-primary`, `border-border`); status is never colour alone (icon plus word). Failed reason text uses `text-destructive`.

## 8. Tests (jest-expo, pure only)

`model.test.ts` (stageOf, summaryPercent, failureReasonOf incl. the PDF vs non-PDF "no text" case, isRetryableReason, filterFlags/isLikelyOnTest), `location.test.ts` (parseLocation, sourceHref/unitFromPageParam round trip, findQuote with whitespace/case), `pipeline.test.ts` (copy the web's cases: mapPool limit 2 and first-failure stop, resume skips done parts, abort, remainingParts, pollIntervalFor, isStalled), `askSources.test.ts` (askRequestOptions for all modes, pickerLabel, citationLink for a source and a recording), `errors.test.ts` (usage limit, 429, failed sentences), `uploadStore.test.ts` (round trip with an injected fs, resume decision `nextStepFor(job)`), `notes.test.ts` (filename sanitising, min length), `links.test.ts` extension (sources paths, query allow-list, hostile `q`). The provider itself is tested through a pure reducer (`uploadsReducer`) exported from `pipeline.ts`.

## 9. Verification

In `mobile/`: `npm run typecheck`, `npm test`, `npx expo export -p ios -p android` (no new native module, so no prebuild change). Web route check: extend `scripts/web-e2e.mjs` with a mocked tRPC (Playwright `page.route("**/api/trpc/**")` returning superjson batches for `sources.list`, `sources.get`, `sources.getUnit`, `ai.askAcrossRecordings`) at 390x844: library (empty, mid-pipeline, ready, failed), detail three tabs, `?page=3&q=...` highlight, Ask with and without sources (`available:false` must show today's Ask), screenshots to `mobile/screenshots/`. On web the picker and `File.upload` are not usable, so mock the picker via a `fileSource.web.ts`-style stub that returns a tiny file. Cannot be checked without a real device: the iOS document picker (iCloud and Files provider files, `.md` types), native upload task progress and its continuation in the background, resume after force-quit, `AppState` resume timing, VoiceOver and Dynamic Type at the largest sizes, universal links to `/sources/:id`. Add these to the "What needs a real device" section of `mobile/README.md` (Lane 1 edit) and a one-line `STORE.md` note that sources add no purchase surface.

## 10. Two lanes, no overlapping files

**Lane 1** (everything in the "Lane 1" list in section 2, plus `README.md` note and its tests: `model`, `location`, `pipeline`, `errors`, `uploadStore`, `notes`, `links`). **Lane 2** (detail screen, the seven detail/Ask components, `ask.tsx`, and tests for `askSources.ts`, which Lane 1 owns as code but Lane 2 owns as test: `askSources.test.ts` lives in Lane 2). Lane 2 may import only these names, which Lane 1 must export exactly (Lane 2 can stub them locally until Lane 1 lands; types come first, in a first commit):

```ts
// src/lib/sources/model.ts
export type SourceKind = "pdf" | "pptx" | "docx" | "text";
export type SourceStatus = "uploaded" | "extracting" | "extracted" | "analyzing" | "ready" | "failed";
export type SourceStage = "waiting" | "reading" | "summarizing" | "ready" | "failed";
export type SourceFlag = { id: number; unitIndex: number; label: string; kind: "definition"|"formula"|"date"|"example"|"exam_point"; text: string; quote: string | null; importance: number };
export type FailureReason = /* as web */ string;
export function stageOf(s: SourceStatus): SourceStage;
export function summaryPercent(s: { partCount: number; partsDone: number; status: SourceStatus }): number | null;
export function failureReasonOf(msg: string | null | undefined, kind?: SourceKind): FailureReason;
export function failureText(r: FailureReason): string;
export function isRetryableReason(r: FailureReason): boolean;
export function isLikelyOnTest(f: Pick<SourceFlag, "kind" | "importance">): boolean;
export function filterFlags<T extends Pick<SourceFlag, "kind"|"importance">>(f: readonly T[], filter: "all"|"test"): T[];
export function kindLabel(k: SourceKind): string;
// src/lib/sources/location.ts
export function formatLocation(label: string | null | undefined): string;
export function sourceHref(id: number, o?: { unitIndex?: number|null; quote?: string|null; tab?: "summary"|"points"|"pages" }): string;
export function unitFromPageParam(v: string | null | undefined, unitCount: number): number | null;
export function findQuote(text: string, quote: string | null | undefined): [number, number] | null;
// src/lib/sources/askSources.ts
export type AskMode = "both"|"sources"|"recordings"; export type AskSourceSelection = { ids: number[]; mode: AskMode };
export const emptySelection: AskSourceSelection;
export function askRequestOptions(s: AskSourceSelection): { includeSources: boolean; includeRecordings: boolean; sourceIds?: number[] };
export function pickerLabel(s: AskSourceSelection, available: number): { key: "all"|"some"|"recordingsOnly"|"none"; count: number };
export function citationLink(c: AskCitation): string;   // AskCitation as web
// src/lib/sources/useSourcesAvailable.ts
export function useSourcesAvailable(courseId?: number): { available: boolean; loading: boolean; sources: SourceListItem[] };
export type SourceListItem = inferRouterOutputs<AppRouter>["sources"]["list"]["sources"][number];
// src/lib/sources/UploadsProvider.tsx
export function useSourceUploads(): { rows: UploadRow[]; resume(source: { id: number; title: string; sizeBytes: number; courseId: number|null; kind: SourceKind }): void; retry(rowId: string): void; active: boolean };
export type UploadRow = { id: string; name: string; stage: "waiting"|"uploading"|"saving"|"reading"|"summarizing"|"finishing"|"done"|"error"; progress: number; partsDone: number; partsTotal: number; sourceId: number | null; error: UploadRowError | null };
// src/components/sources/SourceProgress.tsx
export function SourceProgress(props: { status: SourceStatus; partsDone: number; partCount: number }): JSX.Element;
```

Lane 2 uses `useSourceUploads().resume` for the detail "Continue" button and `SourceProgress` for the working state; it reads data itself with `trpc.sources.get/getUnit`. Neither lane edits the other's files; `src/app/_layout.tsx`, `(app)/_layout.tsx`, `links.ts` and `courses/[id].tsx` are Lane 1 only, and `ask.tsx` is Lane 2 only. Merge order: Lane 1 types commit, then both proceed; Lane 2's route works as soon as `(app)/_layout.tsx` registers it (Lane 1 adds both Stack lines in its first commit).
