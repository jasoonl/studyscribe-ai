# Study sources on mobile: publish-readiness

Branch `claude/phase8-mobile-sources`. Written before any mobile source code exists. No source files or STORE.md were edited.

## 1. Baseline (recorded so a checker can compare later)

Run inside `mobile/` on 2026-10-24, HEAD a61a46f.

| Step | Result |
|---|---|
| `npm install --no-audit --no-fund` | Passed, 981 packages in 23s. `package-lock.json` unchanged (git status clean), nothing to restore. Only npm "glob@7.2.3 deprecated" warnings. |
| `npm run typecheck` (`tsc --noEmit`) | Passed, 0 errors. |
| `npm test` (jest) | 4 suites passed, 49 tests passed, 0 failed (`upload`, `session`, `apiClient`, `recorder/machine`). |
| `NODE_USE_ENV_PROXY=1 npx expo export -p ios -p android` | Passed. iOS bundle 7.0 MB, Android 7.2 MB, `metadata.json` written to `mobile/dist` (git-ignored). |

Pre-existing failures: none. Note `expo-document-picker ~57.0.3` and `expo-file-system` are already in `mobile/package.json`, but `expo-document-picker` is not yet listed under `plugins` in `app.config.ts`.

## 2. Store and review impact

### What does NOT need to change
- **iOS Info.plist usage strings:** none for the document picker. Apple's document picker runs in a separate system process and the app only receives the files the person chooses, so there is no permission prompt and no `NS...UsageDescription` key. Confirmed against current `app.config.ts`: the only strings are microphone and photo library, both already present. Do not add a files or "documents folder" string.
- **Android permissions:** no new permission. The system file picker (Storage Access Framework) needs none. Do not add `READ_EXTERNAL_STORAGE` or `MANAGE_EXTERNAL_STORAGE`.
- **Background modes, capabilities, encryption flag:** unchanged.
- **File-type declarations:** the app only opens a picker; it does not register itself as an app that opens PDFs. So do not add `CFBundleDocumentTypes`, `UTImportedTypeDeclarations` or Android file intent filters. (Only needed later if you want "Open in StudyScribe" from the Files app or the share sheet. That would be a separate review item.) The picker should be told which types to show: pdf, pptx, docx, txt, md/markdown (same list as `SOURCE_EXTENSIONS`, no legacy .doc/.ppt). Use extension checks as well as MIME types, since iOS often reports blank or generic types.
- **No-purchases rule (guideline 3.1.3(f)):** adding sources does not change it, provided nothing new sells or steers anywhere.

### What must change or be re-checked
1. **App Store privacy label.** "User Content > Other user content" is already declared, but the label text and Privacy page must now say it includes uploaded study documents (PDFs, slides, Word files, notes). Also tick the data "shared with a third party" wording on the policy side: document text is sent to the AI provider (OpenAI-compatible) to make summaries, answers and citations. Apple counts a service provider acting for you as not "tracking", so Tracking stays "No". Keep: linked to the user, purpose App Functionality only, no advertising.
2. **`app.config.ts` privacy manifest.** `NSPrivacyCollectedDataTypeOtherUserContent` is already collected, so no new type is needed. Add the `expo-document-picker` plugin (`"expo-document-picker"`, with `iCloudContainerEnvironment` omitted unless iCloud picking is needed). Re-run `npx expo-doctor`. Check that picker and file-system do not require new required-reason API codes; the existing file timestamp and disk space codes already cover file-system use. Re-check after install with the Xcode privacy report on the first EAS build.
3. **Google Play data safety form.** Same change: "Other user-generated content" now covers uploaded documents. Mark it "shared" only with the AI provider as a service provider (processing on your behalf), encrypted in transit, deletable by the user. If you add a "Files and docs" line, Google has a data type called "Files and docs" under "Files and docs"; document contents fit there more exactly than "other user content", so tick it too.
4. **Review notes.** Add a paragraph (wording below) and give review a demo account that already has two or three sources, so a reviewer does not need to upload anything.
5. **Privacy policy (`client/src/pages/Privacy.tsx`) and Terms.** Must name uploaded documents, that their text is sent to the AI provider, retention, and deletion (deleting a source or the account removes the file and its extracted text). Store text must match the policy. Also confirm the Terms say users must have the right to upload what they upload (copyright; reviewers ask about user-uploaded content). Age rating note: uploaded content is private to the person, not shared, so the "user-generated content" answer stays "limited".
6. **Account deletion.** Play and Apple both require deletion to work. Check the server's account deletion and export cover study sources (files and extracted text). This is a server check, not a mobile one.
7. **UI text (pricing).** The app must never show prices, plan names as upsell, upgrade buttons or links to billing. Source limits are the risk: the web shows size and count caps (25 MB per file, 2 MB for text, 25 per course, 60 per person, 250 MB total) and a "usage limit" toast with a "See plans" action (`client/src/lib/usageLimit.ts`). On mobile, show the limits as plain facts ("Files can be up to 25MB") and, when a limit or allowance is hit, show only a message such as "You've reached this month's AI allowance. It resets on <date>." with no "See plans" button, no link and no mention of paid or upgrading. If the app's tRPC error handler reuses the web toast, check it does not bring the "See plans" link. Do not reuse web strings that mention plans. Sources that use up AI generations should show only the neutral Plan and usage line already allowed.
8. **Content that links out.** Do not link to web pages that contain pricing (for example the web source library if it shows plan upsells). Opening a source's original file or a web page for it from the app should use signed or in-app views only.
9. **Android back and storage.** Files copied into app storage for upload should be deleted after upload. Mention nothing in the store forms for this.

### Proposed STORE.md wording (not applied)

Review notes, add after the recording sentences:
> Study sources: users can add their own course documents (PDF, PowerPoint .pptx, Word .docx, plain text and Markdown) from the Files app or other document providers using the system document picker, or paste notes. The app does not request access to the user's files or photos for this; it only receives the files the user picks. The text of a source is sent to our AI provider to make summaries and to answer questions, and answers cite the source and page or slide they came from. Sources are private to the account and can be deleted one by one or with the account (Settings > Delete account). The demo account already has sources in its library.

Privacy label table, replace the User Content row:
| User Content | Audio data, Other user content | Recordings, transcripts, notes, flashcards, chats, and study documents the user uploads (PDF, slides, Word, text) |

Add under the label:
> Study documents are processed by our AI service provider only to give the user summaries, answers and citations. They are not used for advertising, not sold and not used to train models.

(Only keep the last sentence if it is true of the provider's terms; the owner should confirm.)

Google Play data safety, add:
> Files and docs and other user-generated content include study documents the user uploads. Shared only with service providers that process them on our behalf (AI text processing). Encrypted in transit. Deletable in the app and with the account.

Payments section, add one bullet:
> Study sources show size and count limits as plain facts and, when an allowance is used up, a message with its reset date and no plan names, prices, upgrade button or link.

## 3. What `shared/` the app can import

Rule from CLAUDE.md: the app bundles `shared/` through Metro, so only plain TypeScript with no server-only package imports is safe.

Checked: `shared/const.ts` has **no imports at all**, so it is safe. The source additions (new in this branch) are all constants and one pure function:
`MAX_SOURCE_BYTES`, `MAX_SOURCE_LABEL`, `MAX_SOURCE_TEXT_BYTES`, `MAX_SOURCE_TEXT_LABEL`, `MAX_SOURCES_PER_USER`, `MAX_SOURCES_PER_COURSE`, `MAX_SOURCE_BYTES_PER_USER` (+ `_LABEL`), `MAX_SOURCE_UNITS`, `MAX_SOURCE_CHARS`, the `StudySourceKind` type, `SOURCE_EXTENSIONS`, `SOURCE_ACCEPT`, `sourceKindForFileName()`.

Flags and cautions:
- `shared/const.ts` also holds old Manus-era strings (`COOKIE_NAME`, `UNAUTHED_ERR_MSG`); harmless but not source-related.
- `SOURCE_ACCEPT` is a web `<input accept>` string (".pdf,.pptx,..."). Do not pass it to the native picker; build the list from `SOURCE_EXTENSIONS` or MIME types instead.
- Web sources UI also imports from `@shared/const` only (7 uses; `client/src/lib/sourceModel.ts` and the `components/sources/*` files). `shared/i18n/*.ts` gained 164 lines per language for sources text. Those files use only typed plain objects (no package imports; grep found no non-relative imports anywhere in `shared/*.ts`), so they are safe to read, but the mobile app has its own text system, so reuse the wording by hand rather than the web `t()` machinery. Any wording that says "See plans" or similar must not be copied.
- No `shared/*.ts` file imports a server-only package (grep of non-relative imports in `shared/*.ts` returned nothing). `shared/_core/errors.ts` exists but was not needed. `shared/plans.ts` is plain TS and safe to import, but the app must not use it to display prices or upgrade text.
- The web-only `client/src/lib/sourceModel.ts` and `sourceUpload.ts` are not in `shared/`. Mobile cannot import them (client code); anything needed (flag filtering, limit checks) should be re-implemented in `mobile/src/lib` or moved into `shared/` first, as plain TS.

## Checker list (after the mobile work)
- Re-run the four baseline commands; expect typecheck clean, existing 49 tests still passing plus new ones, export succeeding.
- `git status` shows `package-lock.json` changes only if a dependency was deliberately added.
- `app.config.ts` has `expo-document-picker` plugin and no new Info.plist usage string, no new Android permission, no document-type declarations.
- Grep mobile source UI for: "plan", "upgrade", "price", "$", "subscribe", "See plans", "billing" in anything source-related; there should be none.
- STORE.md updated with the wording above, and the Privacy page matches.
