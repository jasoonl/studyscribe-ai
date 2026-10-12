# Legal and compliance checklist

Status of the 20-point "so your app doesn't get sued" checklist, as of October 12, 2026. This is a practical checklist, not legal advice; have a lawyer review the policies before you start charging money.

Operator and contact details live in one place: `shared/legal.ts` (`OPERATOR_NAME`, `CONTACT_EMAIL`, `MIN_AGE`, `REQUEST_RESPONSE_DAYS`, `LEGAL_EFFECTIVE_DATE`). Change them there and every page, the footer and the reset email follow. Bump `LEGAL_EFFECTIVE_DATE` whenever a policy's substance changes.

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Privacy policy | Done. Adds who we are, access-request data, consent-only analytics, a deletion section and a fuller children's section | `/privacy` |
| 2 | Terms of service | Done. Names the operator; covers age and guardian consent, pricing and refunds | `/terms` |
| 3 | Refund policy | Done. Nothing is sold yet; sets the rules for when paid plans launch | `/refunds` |
| 4 | Cookie policy | Done. Lists every cookie and storage item, with purpose and lifetime | `/cookies` |
| 5 | Cookie consent banner | Done. Analytics load only after "Accept"; Decline and Accept look the same; Global Privacy Control counts as Decline; "Cookie settings" in the footer reopens it | `CookieBanner.tsx`, `lib/cookieConsent.ts` |
| 6 | Form consents | Done. Sign-up has separate age and Terms checkboxes, enforced by the server for email and Google sign-up (the Google path previously never recorded `termsAcceptedAt`). The request form now has a privacy notice | `Signup.tsx`, `authRoutes.ts`, `googleOAuthHandler.ts`, `RequestAccess.tsx` |
| 7 | No unnecessary data | Done. We collect no phone, address, school or birth date; the request form asks for a name, not a full name | `RequestAccess.tsx` |
| 8 | Audit third-party SDKs | Done. Removed the unused AWS SDK and framer-motion, and the Manus debug collector (a session-replay script that was shipped as a public file). Vercel Web Analytics and the optional Umami script are now consent-gated. Every remaining data processor is listed in the privacy policy | `package.json`, `vite.config.ts` |
| 9 | Remove dark patterns | Checked. No pre-ticked boxes, no confirmshaming, equal Decline/Accept, account deletion one click away in Settings. Fixed a sign-up button that spun forever when a box was unticked | |
| 10 | Remove hidden fees | Done. Pricing states USD per month, tax shown before paying, no setup or hidden fees, cancel any time | `PricingSection.tsx`, `/terms` |
| 11 | Remove fake reviews | Checked. No testimonials, ratings, user counts or "most popular" badges anywhere | |
| 12 | Remove unsupported claims | Checked. Every claim matches the product: 27 languages, Quizlet/Anki/Notion export, ten-question quizzes with explanations; accuracy is hedged in the FAQ | |
| 13 | Accessibility alt text | Done. The use-case screenshots had empty alt text; every content image now has a description | `UseCases.tsx` |
| 14 | Fix colour contrast | Done. Light theme measured against WCAG AA: accent darkened (3.6 → 4.75:1), gray-400 text replaced (2.5 → 4.8:1), error and timestamp text fixed. Dark mode is not switchable, so it wasn't changed | `index.css` and five pages |
| 15 | Keyboard navigation | Done. "Skip to main content" link on every page; the file drop zones (unreachable by keyboard before), analytics rows and shared flashcards now work with Tab and Enter | `SkipLink.tsx`, `lib/pressable.ts` |
| 16 | Business details | Done. Operator "StudyScribe AI" and contact studyscribeai.help@gmail.com in the footer, on every policy and in the reset email | `shared/legal.ts`, `SiteFooter.tsx` |
| 17 | Age consent for kids' data | Done. Minimum age 13, with guardian agreement under 18; the server rejects sign-ups without the age confirmation | `Signup.tsx`, `authRoutes.ts` |
| 18 | Unsubscribe link in emails | Not needed today. The only email is the transactional password reset, which now says why it was sent and that no marketing email is sent. Any future newsletter or notification email must include an unsubscribe link and a postal address | `server/email.ts` |
| 19 | License fonts and images | Done. Geist (OFL), Lucide (ISC), Hugeicons free (MIT); screenshots are of the app with fictional content; demo music is synthesised; the ElevenLabs voice is credited | `/credits`, `/demo` |
| 20 | Data deletion request | Done. Self-serve in Settings; an email route (subject "Data deletion request") for people who can't sign in, only requested an invite, or are a parent; answered within 30 days | `/privacy` section "Deleting your data" |

## Still for the owner

- **ElevenLabs licence.** The demo narration was made on the ElevenLabs free plan, which does not include a commercial licence and requires attribution. The credit is now on `/demo` and `/credits`. Upgrade to a paid ElevenLabs plan, which includes commercial rights, before relying on the video for marketing. Check their current plan terms.
- **Refund terms.** `/refunds` sets a 14-day window for mistaken or unwanted renewal charges, plus the EU/UK 14-day withdrawal right. Adjust it before paid plans launch if you want different terms, and add in-app cancellation when billing ships.
- **Answer emailed requests.** Deletion, privacy and refund requests to studyscribeai.help@gmail.com need a reply within 30 days (refunds: 5 business days).
- **Google sign-up and invites.** "Continue with Google" on the sign-up page creates an account without checking the invite code server-side. This is tracked separately because it changes who can join.
