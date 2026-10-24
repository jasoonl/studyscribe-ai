# Study sources: what must be true before this ships

Plain-language checklist for the owner. "Study sources" lets students upload PDFs, slides and notes. The server pulls the text out, an AI summarises it, flags test-relevant details, and the AI tutor answers from it. This is not legal advice; have a lawyer glance at the wording changes in section 1.

State of the repo when this was written: no study-sources code or migration 0034 exists yet (the newest migration is 0033). Everything below is a gate for the work in progress.

## 1. Privacy page and Terms wording (must change before launch)

Today the Privacy Policy (`client/src/pages/Privacy.tsx`) says "Your content" is audio, transcripts and what is made from them. It does not mention documents. The Terms "Links, files and copyright" section only talks about audio, video and links.

- [ ] Privacy "Your content": add uploaded documents (PDFs, slides, notes), the text we extract from them, the AI summaries and the test-relevant flags.
- [ ] Privacy provider list: say the extracted text (not the original file) is sent to the AI language-model provider to write summaries and tutor answers, and to the embeddings provider if search by meaning is on. Say plainly that the text of your documents can include other people's writing and anything personal in them.
- [ ] Privacy "How long we keep it": say documents and their extracted text stay until the student deletes them or deletes the account, and that deleting a source removes the file, the text and the summaries.
- [ ] Terms "Links, files and copyright": add that students may upload only course material they have the right to use (their own notes, material their school or instructor lets them use, openly licensed). Course slides, textbooks and exam papers are usually copyrighted. The student, not us, is responsible for having permission and for following their school's rules on sharing materials. Say we may remove material after a copyright complaint (this already exists for the complaints section; make sure documents are covered by its wording).
- [ ] Terms "AI-generated content": the "test-relevant details" flag is a guess, not a promise of what will be on an exam. Say so on the Terms and in the screen where it appears.
- [ ] Sharing: decide whether study sources can ever be shared with a study group or team. If yes, the copyright risk is much higher (we would be helping redistribute a textbook). Recommended for launch: sources are private to the uploader, and the Privacy page's "Teams" paragraph says so.
- [ ] Bump `LEGAL_EFFECTIVE_DATE` in `shared/legal.ts` when the wording changes, and add a line to `docs/compliance/legal-checklist.md`.
- [ ] Cookie page: nothing to change unless new browser storage is used (for example a remembered upload draft).

## 2. Purge, export and account deletion (must all cover the new data)

Existing pattern: `server/purgeRecordings.ts` deletes stored files first, then rows; `server/accountRouter.ts` has `exportData` (line ~71) and `deleteAccount` (line ~146), and slides (`deleteSlidesForUser`, `exportSlidesForUser`) are the closest model because they are stored files plus rows.

- [ ] Deleting one source removes the stored file first, then the extracted text, summary, flags and any search chunks. If the file delete fails, stop and keep the rows (same rule as recordings), so nothing is orphaned and counted against storage forever.
- [ ] Deleting a recording or a course: decide what happens to sources attached to it. Either they are deleted too (add them to `purgeRecordings`) or they survive on their own. Whichever is chosen, it must be tested.
- [ ] Trash and "Empty trash": sources must follow the same rules as recordings, or be deleted immediately with a clear confirm.
- [ ] Account deletion removes every source file in Blob and every row (sources, extracted text, summaries, tutor chat history that quotes them, embeddings). A student who deletes their account must leave no document behind.
- [ ] "Export my data" includes the extracted text, summaries and flags, and a list of the original file names. Decide whether to include the original files; if not, say so on the Privacy page. Keep the export under the size the server can return in one go (extracted text can be large).
- [ ] Add a test that creates a source, runs account deletion, and checks the file and all rows are gone.
- [ ] Tutor chat: if answers quote a source, deleting the source should not leave its text sitting in saved chat history. Decide and test.
- [ ] Update the "How long we keep it" list of what account deletion removes (Privacy page).

## 3. Accepted file types and size caps

Existing caps live in `shared/const.ts`: 1 GB per audio upload, 500 MB per link import. Documents need much smaller caps.

- [ ] Allow only a short list: PDF, plain text, Markdown, and possibly .docx and .pptx. Start with PDF and text only if time is short. Do not accept zip, executables, HTML or images in the first release.
- [ ] Recommended starting caps (PROPOSED, put them in `shared/const.ts` next to the audio caps so the screen text and the server check share one value): 25 MB per file, 200 pages per PDF, about 500,000 characters of extracted text per source, and a per-student limit on number of sources (for example 50 on Free).
- [ ] Check the real file, not just the name or the type the browser reports (browsers report blank or wrong types often; the audio code already has this problem). Read the first bytes ("%PDF-" for PDF) and reject mismatches.
- [ ] Reject empty files and files with no extractable text (scanned pages with no text layer) with a clear message. Do not silently fall back to OCR in the first release; it is slow, costly and raises the AI-provider data question again.
- [ ] Tell the student on the upload screen which types and sizes are accepted.

## 4. Malicious files, zip bombs and PDF risks

The server opens files strangers upload. This is the riskiest part.

- [ ] Parse with a well-known PDF library on the server only, never in a way that runs scripts. Never run embedded JavaScript, never open embedded files or links, never follow external references.
- [ ] Put hard limits on the work: page count, extracted characters, and a time limit per file (for example 20 seconds). A small file can expand into a huge amount of text or memory ("decompression bomb"); stop as soon as a limit is hit and fail the source with a message.
- [ ] .docx and .pptx are zip files. If supported, cap the number of entries, the total unpacked size (for example 100 MB) and the compression ratio before reading anything, and refuse nested archives. This is the main reason to leave them out of the first release.
- [ ] Password-protected or corrupt PDFs must fail cleanly, not crash the server or hang. Add tests with a corrupt file, an encrypted file, a huge-page-count file and a file whose name lies about its type.
- [ ] Extracted text is untrusted. A document can contain hidden instructions aimed at the AI ("ignore your rules and..."). The summary and tutor prompts must treat source text as quoted material, not instructions, and the tutor must not be able to take actions or reveal other students' data because of it. Show summaries as plain text/Markdown with no raw HTML.
- [ ] Never fetch links found inside documents. If "import from link" is offered for documents, reuse the protections in `server/urlAudioImport.ts` (resolve the address and refuse private ones, follow at most 3 redirects and check each, size limit while streaming, never accept an HTML page as a file).
- [ ] Files are served only to their owner (same access check as recordings), with a download header that stops the browser opening them as a web page. Store them under neutral names, as audio and slides already are.
- [ ] Optional but wise: a virus scan is not available on the current hosting, so say in the notes that we rely on never executing the file.
- [ ] Extraction runs on a serverless host with time and memory limits: confirm a 200-page PDF finishes inside the function time limit, or process in steps like `resumeProcessingRecordings` does for audio.

## 5. Storage impact (Vercel Blob, 1 GB)

The whole project shares one 1 GB Blob store on the free Hobby plan. `HANDOFF.md` already lists upgrading it as an owner to-do. When it fills, every upload (audio too) fails and the store is suspended. `getBlobUsage` in `server/storage.ts` reads usage; slides already refuse uploads above 90% full (checked at most every 5 minutes).

- [ ] Upgrade the Blob plan before opening study sources to many students, then set `BLOB_STORAGE_LIMIT_BYTES` to the new limit. A few hundred 20 MB PDFs would use the whole free store.
- [ ] Add the same headroom check slides use: refuse new source uploads above 90% full with a clear message, so documents can never crowd out lecture audio.
- [ ] Consider not keeping the original file at all: keep only the extracted text in the database and delete the PDF once extraction succeeds. This removes most of the storage, privacy and copyright exposure (we would hold text, not a copy of the textbook). If the original is kept, say why (re-download, re-extract).
- [ ] The Admin storage card should show documents separately from audio so the owner can see what is using space.
- [ ] Database size: extracted text and embeddings are stored in TiDB; check the TiDB plan limit, and cap text per source (section 3).

## 6. Usage limits and plan allowances

Plans live in `shared/plans.ts`: Free has 120 transcription minutes and 60 AI generations a month; Basic 600/300; Pro 1800/1500; Max 6000/5000. Limits are only enforced when Stripe is configured or `USAGE_LIMITS_ENFORCED=true` (`server/usage.ts`). Until then there is no cap at all.

- [ ] Each summary, flag pass and tutor answer from a source costs an AI call. Decide whether each counts as one "AI generation" (simplest, and the existing meters and the Terms already describe it) and confirm the numbers still make sense. A long document may need several calls; count one generation per student action, not per internal call.
- [ ] Add a per-plan cap on number and total size of sources (PROPOSED, put in `shared/plans.ts`): for example Free 5 sources, Basic 25, Pro 100, Max 300. The numbers are the owner's call.
- [ ] Add a rate limit on uploads and on tutor questions about sources (Ask is limited to 30 questions per 10 minutes; do the same).
- [ ] Check that a failed extraction does not use up a student's allowance.
- [ ] Pricing, Billing and the Terms must say what the new allowance is. Update `PLAN_FEATURES` in `shared/plans.ts` only once the feature really works.
- [ ] Estimate the AI cost of a worst-case source (200 pages, about 500,000 characters) before launch. If one upload can cost more than a Free student's whole month is worth, shorten the cap or summarise in pieces.
- [ ] Remember limits are off while billing is unconfigured: turn on `USAGE_LIMITS_ENFORCED=true` before opening this to anyone you do not know.

## 7. Owner's hand-done tasks

- [ ] Run migration 0034 against production by hand (`npm run db:migrate`). Deploys do not apply migrations. Back up first or check TiDB's restore point. Code should keep working until it is applied (the way `bookmarks.ts` tolerates a missing table), so deploy the code and run the migration in a short window, then check that uploading a small PDF works.
- [ ] Check the migration has no TiDB-unfriendly defaults (`DEFAULT (now())` or JSON defaults have broken migrations before; use `DEFAULT CURRENT_TIMESTAMP`).
- [ ] Review and approve the new Privacy and Terms wording (section 1); ask a lawyer to look before charging money.
- [ ] Upgrade Vercel Blob and set `BLOB_STORAGE_LIMIT_BYTES` (section 5).
- [ ] Confirm the AI provider's terms: that they do not train on API data, and where they process it. The Privacy page names "an AI language-model provider" without naming it; if you name them, name them for documents too. Sign their data processing agreement if one is offered.
- [ ] Decide and set the proposed caps and plan allowances (sections 3 and 6).
- [ ] Decide how to answer copyright complaints about uploaded documents: emails to studyscribeai.help@gmail.com need a reply and a takedown route. Consider a short written procedure.
- [ ] Switch on `USAGE_LIMITS_ENFORCED=true` (or Stripe) before wide release.
- [ ] After launch, watch the Admin storage card and the AI bill for the first week.

## Release gate (short version)

Do not ship until: Privacy and Terms updated; delete, trash, export and account deletion tested with sources; file types and caps enforced on the server; extraction has time, page and size limits with tests for bad files; Blob headroom check in place and plan upgraded; plan allowances decided; migration 0034 applied.
