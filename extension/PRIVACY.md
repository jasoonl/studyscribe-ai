# StudyScribe for Chrome: privacy

This extension is a shortcut into your StudyScribe account. It is covered by StudyScribe's Privacy Policy at https://studyscribe-ai.vercel.app/privacy; this page explains what the extension itself does.

## What it reads

- **The current tab's address and title**, only when you open the extension on that tab (Chrome's `activeTab`). The title prefills the recording's name.
- **The tab's audio**, only while you are recording it, from the moment you press "Record this tab" until you press "Stop and save" or "Discard" (or close the tab).
- **Your microphone**, only while recording and only when you tick "Include my microphone". Chrome asks your permission the first time.

It does not read page content, browsing history, other tabs, cookies of other sites, or anything while it is closed.

## What it sends, and where

Everything goes to your StudyScribe site (by default `https://studyscribe-ai.vercel.app`, or the address you set in Settings), over HTTPS, using your existing StudyScribe sign-in:

- "Import this page" sends the page address, and the title and language you chose.
- "Record this tab" uploads the recording to StudyScribe's file storage (Vercel Blob) and creates a recording in your account.

From there StudyScribe processes it as it does any recording: audio is transcribed by AssemblyAI and transcripts are used for the study tools you request, as described in the Privacy Policy. "Discard" deletes the recording from memory without sending anything.

The extension sends nothing to anyone else. It has no analytics, no advertising and no tracking, and it is not used to sell data or to determine creditworthiness.

## What it stores

In Chrome's extension storage on your computer: the site address, your last language and microphone choice, and the state of a recording or import in progress (cleared when Chrome closes). It stores no password, token or recording. The audio of a recording in progress is held in memory until it is uploaded or discarded.

## Recording other people

Recording a class or meeting may need the consent of the people in it. Check your school's or workplace's rules and the law where you are, and tell people when you record.

## Contact

Questions: the contact address on https://studyscribe-ai.vercel.app/privacy. Removing the extension removes everything it stored; your recordings stay in your StudyScribe account until you delete them there.
