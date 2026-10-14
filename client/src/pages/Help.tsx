import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Mic, Upload, FileText, Zap, BookOpen,
  HelpCircle, Mail, Search, MessageSquare, ChevronDown, ChevronUp
} from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqs: FAQItem[] = [
  {
    category: "Getting Started",
    question: "How do I record audio?",
    answer: "From the Dashboard, click the 'Recorder' tab. Select 'Record' mode, choose your content type (Student or Professional), then press the red microphone button to start. Press Stop when done, then Save to upload and transcribe your recording.",
  },
  {
    category: "Getting Started",
    question: "What audio file formats can I upload?",
    answer: "StudyScribe AI supports MP3, WAV, OGG, WebM, MP4, and MOV audio and video files up to 1GB. Use the 'Upload' tab in the Recorder section or navigate to /upload to drag-and-drop your file.",
  },
  {
    category: "Getting Started",
    question: "How long does transcription take?",
    answer: "Transcription typically takes 30 seconds to 2 minutes depending on the length of your recording. A progress bar will show the current status. You'll be automatically redirected to the recording page once transcription is complete.",
  },
  {
    category: "AI Features",
    question: "How do I generate a study guide?",
    answer: "Open any recording that has a completed transcript. In the right sidebar under 'AI Study Tools', click 'Study Guide'. The AI will analyze your transcript and generate a comprehensive, structured study guide in markdown format.",
  },
  {
    category: "AI Features",
    question: "How do I take a practice quiz?",
    answer: "Open a recording with a completed transcript, then click 'Practice Quiz' in the AI Study Tools sidebar. The AI generates 10 questions (multiple choice and short answer). Navigate between questions using the dots at the top and submit to see your score and explanations.",
  },
  {
    category: "AI Features",
    question: "What email draft types are available?",
    answer: "Three types: Email Summary (a concise email summarizing the recording), Document (a structured document with sections), and Report (a formal report format). You can also choose a tone: Formal, Casual, Technical, or Persuasive.",
  },
  {
    category: "AI Features",
    question: "What does the AI Assistant do?",
    answer: "The AI Assistant (Tutor tab) lets you have a conversation about your recording. Ask it to explain concepts, quiz you, summarize specific sections, or help you understand difficult topics from your transcript.",
  },
  {
    category: "AI Features",
    question: "How do flashcards work?",
    answer: "Open a recording and click the Flashcards tab. Click 'Generate Flashcards' to have the AI create question-answer pairs from your transcript. You can flip cards to see answers and review them at your own pace.",
  },
  {
    category: "Organization",
    question: "How do I group recordings into courses and tags?",
    answer: "On your library, choose New course under Courses, then use the folder button on any recording to file it in a course and add tags. A recording belongs to one course but can carry several tags. Open a course to see only its recordings, filter by tag, or archive it when the term ends; its recordings stay in your library.",
  },
  {
    category: "Organization",
    question: "How does Ask StudyScribe work?",
    answer: "Choose Ask StudyScribe on your library, type a question, and it looks through the transcripts of your finished recordings (all of them, or just one course) and answers with numbered sources. Select a source to open that recording at the moment it came from. It matches on the words in your question, and where search by meaning is turned on it also finds passages that say the same thing in other words. The note under the chat shows how many of your recordings are indexed for that; choose Index the other to add the rest.",
  },
  {
    category: "Organization",
    question: "How do I keep track of homework and deadlines?",
    answer: "Open a recording and choose Find tasks in the Tasks and deadlines panel. StudyScribe reads the transcript for assignments, readings, exam dates and action items, and works out due dates from what was said (\"next Friday\" counts from the day of the recording). Tick items off, change a date, add your own, or select the time beside one to hear where it was said. Tasks on your library page lists everything across your recordings by due date, and the next few appear under Coming up.",
  },
  {
    category: "AI Features",
    question: "What are key terms and chapters?",
    answer: "On a recording, Find key terms (above the transcript) picks out the important words and names; select one to search the transcript for it, and again to clear the search. Make chapters (under the player) splits the recording into sections by topic, each with a start time; select a chapter to play from there. Both are written once and kept; Redo or the refresh button writes them again.",
  },
  {
    category: "AI Features",
    question: "How do I make an exam pack?",
    answer: "Choose Exam packs on your library (or Exam pack on a course page), then pick a whole course or up to 12 recordings. StudyScribe writes one study guide organised by topic across all of them, then a 15-question practice exam. Check your answers to see your score and an explanation for each question. Permanently deleting a recording also deletes the exam packs made from it.",
  },
  {
    category: "Getting Started",
    question: "Transcripts keep getting a name or term wrong. Can I fix that?",
    answer: "Yes. In Settings, add names and terms to listen for (one per line, up to six words each), and they are sent with every new recording. When you record, upload or import a link you can also add terms for that recording only, and the same box appears when you retry a failed transcription. It improves new transcriptions; to fix one that is done, edit the transcript.",
  },
  {
    category: "Getting Started",
    question: "Can I see the words while I record?",
    answer: "Yes. Turn on Live transcript on the record page before or during a recording, and the words appear as they are spoken. It is off until you turn it on, because your audio is streamed to our transcription provider for as long as it runs. It pauses when you pause, keeps going if you switch tabs, and reconnects by itself if the connection drops; if it can't run, the recording carries on as normal. Live text is a quick preview: after you save, the full transcript with speakers replaces it.",
  },
  {
    category: "Getting Started",
    question: "Can I record a lecture playing in another tab, like Zoom or YouTube?",
    answer: "In Chrome or Edge on a computer, tick Record a tab or screen audio too before you start, or choose Add tab or screen audio while recording. Pick the tab and turn on Also share tab audio (or share your entire screen with system audio). The tab and your microphone are recorded together. If you stop sharing, only the tab audio stops; your microphone recording continues. Other browsers can't share tab audio, so the option doesn't appear there.",
  },
  {
    category: "AI Features",
    question: "What is Study help?",
    answer: "With live transcript on, the Study help panel beside it answers quick questions about the last few minutes: explain a term, recap the last two minutes, likely exam points, questions to ask, or your own question. It only uses the live text on your screen, keeps answers short, and is there to help you follow and take part, not to answer tests for you. It is always visible; there is no hidden mode.",
  },
  {
    category: "Getting Started",
    question: "Is there a captions view?",
    answer: "Yes. While live transcript is on, choose Captions to show the live text full screen in large white-on-black type. Use the minus and plus buttons, or the - and + keys, to change the size (it is remembered on this device), and Esc or Exit to close it.",
  },
  {
    category: "AI Features",
    question: "What are follow-ups?",
    answer: "On a finished recording, Plan follow-ups suggests a few dated steps for the next days, spaced out the way review works best: what to go over tomorrow, what to practise in a few days, a question to bring to class, something to read. Tick them off as you go; Plan again replaces the ones you haven't done. Practice steps link to the recording's flashcards, and where reminders are set up you get one in Notifications on the day.",
  },
  {
    category: "Organization",
    question: "How do I search across all my recordings?",
    answer: "Use the Knowledge Base (accessible from the Dashboard header). Type any keyword and it will search across all your recording titles and transcript content, showing relevant snippets with highlighted matches.",
  },
  {
    category: "Organization",
    question: "How do I delete a recording?",
    answer: "From the Dashboard library, click the trash icon on any recording card. Deleted recordings move to the Trash tab where you can restore them or permanently delete them.",
  },
  {
    category: "Sharing",
    question: "What can people I share a recording with do?",
    answer: "Choose Share on a recording and pick a role for each person or group. Can view: listen and read the transcript and study materials. Can comment: also highlight words and comment on the transcript. Can edit: also correct the transcript text and rename speakers. You can change a role or stop sharing at any time from the same window. A public link is always view only, and never shows comments.",
  },
  {
    category: "Sharing",
    question: "How do comments and highlights work?",
    answer: "On a transcript you own, or one shared with you at comment or edit access, select some words in a line. Choose Highlight to mark them or Comment to start a thread. With a keyboard, Tab to a line's comment button. Threads are listed under the transcript: reply, resolve when it's settled (the person who started it, an editor or the owner can), or delete your own. As the owner you can delete any comment on your recording.",
  },
  {
    category: "Sharing",
    question: "How do study groups work?",
    answer: "Open Groups from your library and start one for a class. Add classmates who already have an account by email, or send them the join link. Share a recording or a whole course to the group and pick what members can do; a shared course includes recordings you add to it later. The group page shows what's shared and recent comments. Leaving a group stops sharing what you shared there.",
  },
  {
    category: "Sharing",
    question: "Can I send notes to Notion or Google Docs?",
    answer: "Yes, where the site has it set up. Connect Notion or Google Docs once under Settings, Connected apps. Then use Send to on any study note or study guide. Notion asks which pages StudyScribe may add to, and the note becomes a new page under the one you pick. Google Docs creates a new document in your Drive; StudyScribe can only see the files it created. Disconnect at any time.",
  },
  {
    category: "Sharing",
    question: "How do webhooks work?",
    answer: "Under Settings, Webhooks, add a public https address and pick events: a recording finishes processing (recording.completed), a transcript is ready (transcript.ready, includes the text), or notes are written (notes.generated). Each delivery is a JSON POST with a StudyScribe-Signature header of the form t=<unix time>,v1=<hex>. To check it, compute HMAC-SHA256 of '<t>.<raw body>' with your signing secret and compare it to v1, and reject times more than 5 minutes old. Failed deliveries are retried for about a day with growing gaps; you can send a test or redeliver from Settings.",
  },
  {
    category: "AI Features",
    question: "What does Skip silence do?",
    answer: "Turn on Skip silence under the audio player and playback jumps over pauses of 2 seconds or more between spoken lines, using the transcript's timestamps. The player shows how much it will skip. It stays on for your browser until you turn it off.",
  },
  {
    category: "Account",
    question: "How do I reset my password?",
    answer: "On the Login page, click 'Forgot password?' and enter your email address. You'll receive a password reset link. Click the link in the email and enter your new password.",
  },
  {
    category: "Account",
    question: "Can I use Google to sign in?",
    answer: "Yes! On the Login or Sign Up page, click 'Continue with Google' to authenticate with your Google account. Note: you must have an existing account to sign in with Google.",
  },
  {
    category: "Getting Started",
    question: "What is on the Get set up list?",
    answer: "The list on your library shows five first steps: record or upload a lecture, generate notes, try flashcards, create a course and ask a question. Each one ticks itself off when you do it. Choose Hide to put the list away; it also disappears once everything is done.",
  },
  {
    category: "Getting Started",
    question: "Can I sign up without an invite?",
    answer: "When open sign-up is on, the home page says 'Sign up free' and anyone can create a Free account. If the site can send email, you then confirm your address from the link we send before transcribing; the dashboard can send it again. Otherwise sign-up needs an invite code, which you can ask for on the Request access page.",
  },
  {
    category: "AI Features",
    question: "How do I translate a transcript, study guide or notes?",
    answer: "Use 'Translate' next to Export on the transcript, at the top of a study guide, or on a set of notes, and pick a language. Long transcripts are translated part by part and each part appears as soon as it is ready, keeping times and speakers. Translations are saved, so opening one again is instant. Translating one item into one language counts as a single AI generation.",
  },
  {
    category: "Account",
    question: "What do the plans include, and what counts against them?",
    answer: "Every plan has every feature. Plans differ in how many minutes of audio you can transcribe and how many AI generations you can use each month. A generation is one set of notes, flashcards, a quiz, a guide, a draft, a translation, a key terms or chapters list, or one tutor or Ask answer. A recording counts once, by its length, when its transcript is ready; a retry does not count again. Usage resets on the 1st of each month (UTC). See Billing or Settings for what you have used.",
  },
  {
    category: "Account",
    question: "How do I upgrade, change plan or cancel?",
    answer: "Open Billing from Settings. 'Choose' a plan to pay on Stripe's secure checkout, which shows the full price with any tax before you pay. Once you have a plan, 'Change plan or card' opens Stripe's billing portal, and 'Cancel plan' takes you straight to cancelling. After cancelling you keep the plan until the end of the period you paid for.",
  },
  {
    category: "Organization",
    question: "How do I see my classes from Google Calendar?",
    answer: "Connect Google Calendar in Settings under Connected apps (read-only access). Your library then shows the next seven days. Choose 'Remind me' on a class to get a notification when it starts while StudyScribe is open in a tab, plus a once-a-day summary of the next 24 hours. A recording you start during a class, or up to ten minutes before, is named after it.",
  },
  {
    category: "Recording",
    question: "Can StudyScribe record a Zoom, Google Meet or Teams call for me?",
    answer: "Yes, where the site has it set up. Choose 'Send a note-taker' under Online meetings on your library, or 'Note-taker' next to a calendar event that has a meeting link. A note-taker named 'StudyScribe note-taker (recording for you)' joins, posts a message in the meeting chat saying it is recording, and leaves when the call ends; the recording then appears in your library and is transcribed. Before sending it you confirm you will tell everyone in the meeting, and get their consent where your law, school or workplace requires it. Let it in if the meeting has a waiting room. 'Stop recording' makes it leave; what it recorded so far is still saved.",
  },
  {
    category: "Recording",
    question: "How do I capture slides from an online class?",
    answer: "On the Record page, tick 'Record a tab or screen audio too' and then 'Capture slides', and share the tab or screen with the slides. Each time the picture changes and settles, StudyScribe keeps a picture of it, at most one every 8 seconds and 40 per recording; a moving cursor or a playing video does not add slides. They are saved after the recording, appear between the transcript lines at the moment they were shown and in a Slides strip under the player. Slides stay in the browser until you save, so they are not recovered after a crash. Works in Chrome and Edge on a computer.",
  },
  {
    category: "Sharing",
    question: "Can I email the notes to the people at a meeting?",
    answer: "For a recording made during a Google Calendar event or by the note-taker, the recording page shows 'Email notes to attendees'. Choose the notes, add a message if you like and tick the people to send to; nobody is ticked for you and nothing is sent until you press Send. Each person gets their own email from 'Your name via StudyScribe', with replies coming to you, and a link to stop all StudyScribe email. People who used that link are shown and skipped.",
  },
  {
    category: "Account",
    question: "How do teams work?",
    answer: "Start a team from Settings. Members share courses into the team's library, and everyone in the team can open those recordings, transcripts and notes (read only). Owners and admins invite people by email and see each member's usage this month. The owner buys seats on the Team plan (each member then gets the Team allowance), can verify the school's or company's domain so Google Workspace accounts from it join on their own, and can set up SAML single sign-on, after which members use 'Sign in with SSO' on the login page. Leaving a team takes your courses out of its library; your recordings stay yours.",
  },
  {
    category: "Account",
    question: "Is there an API?",
    answer: "Yes. Create a personal API key in Settings under API keys, read only or read and write, and see the API page (/developers) for the endpoints and examples. Keys act as you and count toward your plan; they can never change billing, manage keys or delete your account. Revoke a key in Settings if it leaks.",
  },
];

const categories = ["All", ...Array.from(new Set(faqs.map(f => f.category)))];

const features = [
  { icon: Mic, title: "Audio Recording", desc: "Record lectures, meetings, and notes directly in your browser with pause/resume support.", color: "bg-blue-50 text-blue-600" },
  { icon: Upload, title: "File Upload", desc: "Upload existing audio files (MP3, WAV, OGG, WebM, MP4, MOV) up to 1GB.", color: "bg-green-50 text-green-600" },
  { icon: FileText, title: "AI Transcription", desc: "Automatic speech-to-text powered by Whisper AI with language detection.", color: "bg-primary/5 text-primary" },
  { icon: Zap, title: "Flashcards", desc: "Auto-generate study flashcards from any transcript with one click.", color: "bg-yellow-50 text-yellow-600" },
  { icon: BookOpen, title: "Study Guides", desc: "Generate comprehensive, structured study guides in markdown format.", color: "bg-orange-50 text-orange-600" },
  { icon: HelpCircle, title: "Practice Quizzes", desc: "10-question quizzes with multiple choice, short answer, and explanations.", color: "bg-red-50 text-red-600" },
  { icon: Mail, title: "Email Drafts", desc: "Generate email summaries, documents, and reports with customizable tone.", color: "bg-pink-50 text-pink-600" },
  { icon: MessageSquare, title: "AI Assistant", desc: "Chat with an AI tutor about your recording content using Socratic method.", color: "bg-primary/5 text-primary" },
  { icon: MessageSquare, title: "Ask StudyScribe", desc: "Ask a question across every lecture or one course and jump to the cited moment.", color: "bg-sky-50 text-sky-600" },
  { icon: Search, title: "Knowledge Base", desc: "Full-text search across all your recordings and transcripts.", color: "bg-teal-50 text-teal-600" },
  { icon: MessageSquare, title: "Comments and groups", desc: "Share with view, comment or edit access, discuss transcript lines and share courses with a study group.", color: "bg-sky-50 text-sky-600" },
];

export default function Help() {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("All");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const filteredFaqs = activeCategory === "All" ? faqs : faqs.filter(f => f.category === activeCategory);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
      {/* Header */}
      <div className="border-b bg-card px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Dashboard</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h1 className="text-lg font-semibold">Help & Documentation</h1>
            <p className="text-xs text-muted-foreground">Learn how to use StudyScribe AI</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Features Overview */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {features.map((f) => (
              <Card key={f.title} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className={`w-9 h-9 rounded-lg ${f.color} flex items-center justify-center mb-3`}>
                    <f.icon className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">Frequently Asked Questions</h2>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-4">
            {categories.map((cat) => (
              <Badge
                key={cat}
                variant={activeCategory === cat ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </Badge>
            ))}
          </div>

          <div className="space-y-2">
            {filteredFaqs.map((faq, i) => (
              <Card key={i} className="border-0 shadow-sm overflow-hidden">
                <button
                  className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="text-xs flex-shrink-0">{faq.category}</Badge>
                    <span className="text-sm font-medium truncate">{faq.question}</span>
                  </div>
                  {openFaq === i ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 pt-1 border-t bg-muted/20">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>

        {/* Contact / Support */}
        <Card className="border-0 shadow-sm bg-brand-mist">
          <CardContent className="p-6 text-center">
            <MessageSquare className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <h3 className="font-semibold mb-1">Still have questions?</h3>
            <p className="text-sm text-muted-foreground mb-4">Use the AI Assistant inside any recording to get help with your content, or start a new recording to explore the features.</p>
            <Button onClick={() => navigate("/dashboard")} size="sm">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
