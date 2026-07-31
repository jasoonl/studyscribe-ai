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
    answer: "StudyScribe AI supports MP3, WAV, OGG, WebM, and MP4 audio files up to 16MB. Use the 'Upload' tab in the Recorder section or navigate to /upload to drag-and-drop your file.",
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
    question: "How do I search across all my recordings?",
    answer: "Use the Knowledge Base (accessible from the Dashboard header). Type any keyword and it will search across all your recording titles and transcript content, showing relevant snippets with highlighted matches.",
  },
  {
    category: "Organization",
    question: "How do I delete a recording?",
    answer: "From the Dashboard library, click the trash icon on any recording card. Deleted recordings move to the Trash tab where you can restore them or permanently delete them.",
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
];

const categories = ["All", ...Array.from(new Set(faqs.map(f => f.category)))];

const features = [
  { icon: Mic, title: "Audio Recording", desc: "Record lectures, meetings, and notes directly in your browser with pause/resume support.", color: "bg-blue-50 text-blue-600" },
  { icon: Upload, title: "File Upload", desc: "Upload existing audio files (MP3, WAV, OGG, WebM, MP4) up to 16MB.", color: "bg-green-50 text-green-600" },
  { icon: FileText, title: "AI Transcription", desc: "Automatic speech-to-text powered by Whisper AI with language detection.", color: "bg-purple-50 text-purple-600" },
  { icon: Zap, title: "Flashcards", desc: "Auto-generate study flashcards from any transcript with one click.", color: "bg-yellow-50 text-yellow-600" },
  { icon: BookOpen, title: "Study Guides", desc: "Generate comprehensive, structured study guides in markdown format.", color: "bg-orange-50 text-orange-600" },
  { icon: HelpCircle, title: "Practice Quizzes", desc: "10-question quizzes with multiple choice, short answer, and explanations.", color: "bg-red-50 text-red-600" },
  { icon: Mail, title: "Email Drafts", desc: "Generate email summaries, documents, and reports with customizable tone.", color: "bg-pink-50 text-pink-600" },
  { icon: MessageSquare, title: "AI Assistant", desc: "Chat with an AI tutor about your recording content using Socratic method.", color: "bg-indigo-50 text-indigo-600" },
  { icon: Search, title: "Knowledge Base", desc: "Full-text search across all your recordings and transcripts.", color: "bg-teal-50 text-teal-600" },
];

export default function Help() {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("All");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const filteredFaqs = activeCategory === "All" ? faqs : faqs.filter(f => f.category === activeCategory);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
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
        <Card className="border-0 shadow-sm bg-gradient-to-r from-blue-50 to-indigo-50">
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
    </div>
  );
}
