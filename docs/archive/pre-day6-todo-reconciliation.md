# StudyScribe AI — Pre-Day-6 TODO Reconciliation

**Scope.** This review compared all checklist entries dated before Day 6 with the currently deployed source code, routes, schema, and application behavior. It is intended to remove misleading completion claims and to ensure the product roadmap reflects what users can actually do.

| Historical claim | Current status | Reconciliation action |
|---|---|---|
| Browser push notifications | **Not implemented.** The app provides persistent in-app notifications in the bell, but no service worker, push subscription, or browser push delivery. | The historical TODO is corrected to describe the actual in-app notification capability. |
| Speaker diarization display | **Partially supported.** The transcript data model accepts an optional speaker field, but the current transcription provider does not produce diarization data. | The UI must only display speakers when an upstream source provides them; no claim of diarization is made. |
| Timestamp-synchronized transcript viewer | **Implemented in this release.** Segment rows now show timestamps, highlight the active segment, and seek/play the associated audio. | The historical TODO now has matching functionality. |
| Quizlet, Anki, Notion, and Google Docs export | **Partially implemented.** A usable tab-separated export supports Quizlet and Anki imports; Markdown supports Notion import/copy-paste. Direct Google Docs and Notion API export are not enabled. | The historical claim is narrowed to the actual export formats. |
| Password reset email delivery | **Not implemented.** No transactional email provider is configured. The prior token-return behavior was insecure. | Token exposure is removed. The UI now clearly explains that recovery email delivery is not configured rather than claiming an email was sent. |
| In-app payments | **Not implemented.** The billing screen is informational and no payment provider is configured. | The misleading upgrade alert was replaced with a truthful message that no plan change occurred. |

## Result

The core, self-contained feature set has been reconciled and the important user-facing gaps identified in code have either been implemented in this release or relabeled accurately. The remaining provider-dependent capabilities require explicit service setup and credentials before implementation: a transactional email provider for password recovery, a payment provider for subscriptions, and a web-push provider plus service-worker configuration for browser notifications.

## Browser Verification

The password reset page now exposes recovery failures inline and does not show or return a reset token to the browser. This is intentional until transactional email delivery is configured, preventing the prior insecure behavior where a reset credential could be exposed in the response.
