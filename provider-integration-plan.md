# Provider Integration Plan

StudyScribe will use **Resend** for transactional password-reset email, the **standard Web Push protocol** with a VAPID key pair for browser notifications, and **AssemblyAI** for speaker-labeled transcription. Each capability is event-driven: the application sends a reset email after a user request, sends push messages when a transcription completes or fails, and requests diarization while processing uploaded audio. No background polling service is required.

| Capability | Provider and request model | Required configuration | User-facing result |
|---|---|---|---|
| Password recovery | Resend `POST /emails` with sender, recipient, subject, and HTML content | Resend API key and verified sender address | A time-limited reset link is delivered without exposing a credential in the browser. |
| Browser push | Browser Push API plus service worker; server signs messages with VAPID credentials | VAPID public/private key pair and contact subject | Opted-in users receive a system notification when transcription completes or fails, even when the app is not open. |
| Speaker labels | AssemblyAI asynchronous transcript request with `speaker_labels: true` | AssemblyAI API key | Transcript segments are labeled by generic speaker identity and remain linked to their timestamps. |

Resend requires an API key and sender address; its email endpoint accepts `from`, `to`, `subject`, and `html` values. AssemblyAI returns timestamped `utterances` with a speaker label when diarization is enabled. The browser push integration will request permission only after an authenticated user explicitly opts in.

## References

[1]: https://resend.com/docs/api-reference/emails/send-email "Resend — Send Email API"
[2]: https://resend.com/docs/introduction "Resend — Introduction"
[3]: https://www.assemblyai.com/docs/pre-recorded-audio/label-speakers "AssemblyAI — Speaker Diarization"
