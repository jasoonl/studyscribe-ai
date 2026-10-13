# Chrome Web Store listing

**Name:** StudyScribe AI

**Summary (132 characters max):**
Record a lecture tab's audio or import the page you are on into StudyScribe for transcripts, notes, flashcards and quizzes.

**Category:** Education

**Description:**

StudyScribe turns lectures and meetings into transcripts and study material. This extension adds two buttons to Chrome for the tab you are on.

Import this page
Send a lecture video, podcast episode or any page with an audio or video file to StudyScribe. It finds the media, transcribes it with speaker labels, and it appears in your library ready for notes, flashcards, quizzes and the AI tutor.

Record this tab
For an online class or a video that cannot be imported, record the tab's sound directly. You keep hearing it while it records, you can add your microphone for your own questions, and you can close the popup: recording carries on until you press Stop, with the time shown on the toolbar icon. When you stop, the recording is uploaded to your account and transcribed.

The extension uses your StudyScribe sign-in from this browser, so there is nothing new to set up. You need a StudyScribe account.

Your recordings go only to your StudyScribe account. The extension has no analytics or tracking. Please record only where you are allowed to, and tell people when you do.

**Single purpose:**
Send the current tab's lecture or meeting audio to the user's StudyScribe account, either by importing the page's address or by recording the tab's audio, so StudyScribe can transcribe it.

**Permission justifications:**

- activeTab: read the address and title of the tab the user opened the extension on, to import it or name the recording.
- tabCapture: record the audio of the tab the user chose, after they press "Record this tab".
- offscreen: keep recording in an offscreen document while the popup is closed, until the user presses Stop.
- storage: remember the StudyScribe site address, the user's language and microphone choice, and the state of a recording in progress.
- Host permission (studyscribe-ai.vercel.app): call the StudyScribe API with the user's existing StudyScribe session.
- Optional host permissions: only requested if the user points the extension at their own StudyScribe server in Settings.

**Remote code:** No. All code is in the package.

**Data use disclosures:** Website content (the page address, when the user imports it) and audio (recordings, when the user records). Used only to provide the feature; not sold, not transferred for unrelated purposes, not used for creditworthiness.
