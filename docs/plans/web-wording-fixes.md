# Web wording fixes: storage cap sentence and transient extraction failure

Both bugs live in the web code the iPhone app was ported from. Mobile already has the fixes (`mobile/src/lib/sources/errors.ts`: `CAP_SENTENCE` checked first; `model.ts`: generic sentence mapped to `failed`). Port them. No server change, no i18n keys (cap errors show the server's own sentence via the existing `{ kind: "message" }` row; all six languages already have the other keys).

## Findings (exact server sentences, server/studySources.ts)
- L120 `You can keep up to ${60} study sources. Delete one you no longer need first.` (BAD_REQUEST, no "limit", already shown as written).
- L123 `You have reached the storage limit for study sources. Delete one you no longer need first.` (BAD_REQUEST) contains "limit", so `failureReasonOf` returns `limitReached` and the row says "A limit was reached ({max} sources per course)": wrong text, no useful action. THE BUG.
- L131/L619 `A course can hold up to ${25} study sources.`; L376 `Storage is nearly full, so uploads are paused. Your existing material is safe.` (PRECONDITION_FAILED): reach the message branch today, but only via fallthrough.
- L480 generic extract catch: `We could not read this file. It may be damaged. Try uploading it again.` matches the `damaged` rule, so `unreadable`, Retry hidden (`isRetryableReason`), pipeline job dropped. Specific extractor sentences stay unreadable: `This file is damaged and could not be opened.`, `This PDF is damaged or not a real PDF, so its text could not be read.`
- `limitReached` cannot come from a stored `errorMessage`: extractor "size limit" and "the limit is" are caught by earlier rules (tooLarge, tooLong). The only real producer is the storage sentence, so the heuristic can go. Real usage limits already use `usageLimitOf` (`error.data.usageLimit`) first in `describeError`, which gives the allowance sentence; the usage-limit toast (`client/src/lib/usageLimit.ts`) is only called from `SourceUploadsContext.tsx:228` and is correct as is.
- Other raw-message paths: `SourceCard` and `SourceDetail` only render `t("sources.reason.*")` from `failureReasonOf(source.errorMessage)`; `SourceUploadRow` renders `error.text` only for `kind: "message"`. No other source call shows plan or price wording.

## Edits
1. `client/src/lib/sourceModel.ts` `failureReasonOf`:
   - Before the `damaged` group add: `if (text.includes("we could not read this file")) return "failed";` (retryable). Keep `could not read` for other sentences.
   - Delete the final `if (text.includes("limit") || text.includes("allowance")) return "limitReached";`. Keep `"limitReached"` in the `FailureReason` union and the `sources.reason.limitReached` keys (the i18n test lists them; removal is not worth six-language churn).
2. `client/src/contexts/SourceUploadsContext.tsx` `describeError`: add `const CAP_SENTENCE = /keep up to|storage limit|can hold up to|storage is nearly full/i;` and, inside the `TRPCClientError` branch right after the TOO_MANY_REQUESTS check and BEFORE `failureReasonOf(message)`, `if (message && CAP_SENTENCE.test(message)) return { kind: "message", text: message };`. Keep the existing BAD_REQUEST fallback after `failureReasonOf` unchanged. Update the stale comment to say cap sentences are shown as written.

## Tests
- `client/src/lib/sourceModel.test.ts`: add cases using the exact sentences:
  - `["generic read failure", "We could not read this file. It may be damaged. Try uploading it again.", "failed"]` in `cases`; and assert `isRetryableReason(failureReasonOf(thatSentence))` is true.
  - Keep `damaged zip` / `damaged pdf` as `unreadable` (proves the specific sentences still win).
  - `it("does not read a cap sentence as a usage limit")`: for the storage, 60-source, per-course and nearly-full sentences, `failureReasonOf(s)` is `"failed"`, never `"limitReached"`.
- `client/src/contexts/SourceUploadsContext.test.ts` (`trpcError(message, code, data?)` helper exists): extend "shows plain cap sentences" to a `test.each` over the four sentences (BAD_REQUEST for three, PRECONDITION_FAILED for nearly full) expecting `{ kind: "message", text: <same> }`; add the storage sentence explicitly asserting it is not `{ kind: "reason", code: "limitReached" }`; add a `SourceFailedError("We could not read this file. It may be damaged. Try uploading it again.", "pdf")` expecting `{ kind: "reason", code: "failed" }`, and one with `"This file is damaged and could not be opened."` expecting `unreadable`. The existing `usageLimit` marker test (FORBIDDEN with `data.usageLimit`) stays and must still return `{ kind: "usageLimit" }`.

## Verify (run from /home/user/wt-web-fix)
`npm run check`; `npx vitest run client shared server/i18n.test.ts`; `npm run build`. Also `git grep -n "limitReached" client` to confirm only the type, the i18n keys and the tests remain. Manual: with a mocked `sources.register` rejecting with the storage sentence, the upload row shows that sentence, not the per-course text; a source stored with the generic sentence shows Retry on `SourceCard` and `SourceDetail`.
