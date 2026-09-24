import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Zap, BookOpen, MessageSquare, Download } from "lucide-react";
import { Link } from "wouter";
import DemoWalkthrough from "@/components/DemoWalkthrough";

export default function Demo() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
          <h1 className="text-xl font-bold">StudyScribe AI Demo</h1>
          <div className="w-20" />
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Hero Section */}
          <div className="text-center space-y-6">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              See StudyScribe AI in Action
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              See how students and professionals transform their learning and productivity with AI-powered transcription and study tools.
            </p>
          </div>

          {/* Product walkthrough */}
          <Card className="p-6 border-2 border-border">
            <DemoWalkthrough />
          </Card>

          {/* Features Showcase */}
          <div className="space-y-8">
            <h2 className="text-3xl font-bold">Key Features Demonstrated</h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Feature 1: Recording */}
              <Card className="p-6 border-2 border-border hover:border-accent/50 transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">Live Recording</h3>
                <p className="text-muted-foreground mb-4">
                  Record lectures and meetings directly in your browser. No downloads, no plugins—just click and start recording.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Real-time duration tracking
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Pause and resume controls
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Automatic cloud upload
                  </li>
                </ul>
              </Card>

              {/* Feature 2: Transcription */}
              <Card className="p-6 border-2 border-border hover:border-accent/50 transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4">
                  <BookOpen className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">Instant Transcription</h3>
                <p className="text-muted-foreground mb-4">
                  Automatic speech-to-text powered by advanced AI. Get perfect transcripts in seconds, not hours.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    99% accuracy rate
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Multiple language support
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Editable transcripts
                  </li>
                </ul>
              </Card>

              {/* Feature 3: Study Tools */}
              <Card className="p-6 border-2 border-border hover:border-accent/50 transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4">
                  <Download className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">AI Study Tools</h3>
                <p className="text-muted-foreground mb-4">
                  Automatically generate study materials from your recordings. Study smarter, not harder.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Key concepts extraction
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Auto-generated flashcards
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Study guides & summaries
                  </li>
                </ul>
              </Card>

              {/* Feature 4: AI Tutor */}
              <Card className="p-6 border-2 border-border hover:border-accent/50 transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4">
                  <MessageSquare className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">AI Tutor Chat</h3>
                <p className="text-muted-foreground mb-4">
                  Get personalized help from an AI tutor that understands your specific lecture content.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Socratic questioning mode
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Context-aware answers
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    24/7 availability
                  </li>
                </ul>
              </Card>
            </div>
          </div>

          {/* Use Cases */}
          <div className="space-y-8">
            <h2 className="text-3xl font-bold">Perfect For</h2>

            <div className="grid md:grid-cols-2 gap-6">
              <Card className="p-6 border-2 border-border">
                <h3 className="text-xl font-bold mb-3">Students</h3>
                <ul className="space-y-3 text-muted-foreground">
                  <li>✓ Never miss important lecture points again</li>
                  <li>✓ Study more efficiently with AI-generated materials</li>
                  <li>✓ Get help from your personal AI tutor</li>
                  <li>✓ Prepare for exams faster and smarter</li>
                </ul>
              </Card>

              <Card className="p-6 border-2 border-border">
                <h3 className="text-xl font-bold mb-3">Professionals</h3>
                <ul className="space-y-3 text-muted-foreground">
                  <li>✓ Capture meeting details automatically</li>
                  <li>✓ Generate action items and summaries</li>
                  <li>✓ Draft follow-up emails in seconds</li>
                  <li>✓ Keep your team aligned and informed</li>
                </ul>
              </Card>
            </div>
          </div>

          {/* CTA Section */}
          <Card className="p-8 border-2 border-accent bg-gradient-to-br from-accent/5 to-primary/5">
            <div className="text-center space-y-6">
              <h2 className="text-3xl font-bold">Ready to Get Started?</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Join thousands of students and professionals who are already transforming their learning and productivity with StudyScribe AI.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/dashboard">
                  <Button size="lg" className="bg-accent hover:bg-accent/90 text-primary font-semibold">
                    Go to Dashboard
                  </Button>
                </Link>
                <Link href="/">
                  <Button size="lg" variant="outline" className="border-2 border-primary">
                    Back to Home
                  </Button>
                </Link>
              </div>
            </div>
          </Card>

          {/* FAQ Section */}
          <div className="space-y-8">
            <h2 className="text-3xl font-bold">Frequently Asked Questions</h2>

            <div className="space-y-4">
              {[
                {
                  q: "How accurate is the transcription?",
                  a: "Our AI achieves 99% accuracy using advanced speech recognition. You can also edit transcripts manually if needed."
                },
                {
                  q: "What file formats are supported?",
                  a: "We support MP3, WAV, OGG, MP4, and WebM formats. Maximum file size is 1GB."
                },
                {
                  q: "Can I export my study materials?",
                  a: "Yes! Export transcripts as text files, and share flashcards to Quizlet, Anki, or Notion."
                },
                {
                  q: "Is my data private and secure?",
                  a: "Absolutely. All recordings are encrypted in transit and at rest. We never sell or share your data."
                }
              ].map((faq, i) => (
                <Card key={i} className="p-6 border-2 border-border">
                  <h3 className="font-bold mb-2">{faq.q}</h3>
                  <p className="text-muted-foreground">{faq.a}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
