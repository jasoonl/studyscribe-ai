import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, ArrowRight, Zap, BookOpen, Briefcase, Users, BarChart3, Shield } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";

/**
 * ScribeSync AI — Marketing Landing Page + Dashboard Entry
 * 
 * If user is authenticated, they see a CTA to go to dashboard.
 * If not authenticated, they see the full marketing landing page.
 */

type Audience = "student" | "professional";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [audience, setAudience] = useState<Audience>("student");
  const [isScrolled, setIsScrolled] = useState(false);

  // Redirect to dashboard if authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const studentContent = {
    headline: "From Lecture to Mastery.",
    subheading: "AI-powered study tools that learn with you.",
    cta: "Start Learning Smarter",
    description: "Stop stressing about what you missed in lecture. ScribeSync AI listens, takes perfect notes, and instantly transforms your classes into custom flashcards, practice exams, and a 24/7 personalized AI tutor.",
    heroImage: "https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/hero-student-F84Hba5Y9ResacfdkYA7Zt.webp",
    painPoints: [
      { title: "Information Overload", desc: "Too much to absorb, too little time to process." },
      { title: "Note-Taking Stress", desc: "Copying down words instead of understanding concepts." },
      { title: "Exam Anxiety", desc: "Unsure what to study or how to prepare effectively." }
    ],
    solutions: [
      { title: "Instant Study Guides", desc: "Automatically generated from your professor's exact words." },
      { title: "24/7 AI Tutor", desc: "Ask questions anytime, get Socratic guidance based on your lecture." },
      { title: "Flashcard Magic", desc: "One-click export to Quizlet, Anki, or Notion." }
    ],
    pricingTier: "Pro (Student)",
    pricingPrice: "$4.99 - $7.99",
    pricingFeatures: [
      "Unlimited recording hours",
      "AI Socratic tutor mode",
      "Auto-generated flashcards",
      "Whiteboard photo integration",
      "Offline recording support"
    ]
  };

  const professionalContent = {
    headline: "Smarter Meetings. Better Outcomes.",
    subheading: "AI-powered summaries, transcripts, and action items—so your team stays aligned.",
    cta: "Automate Your Admin Work",
    description: "Automate your admin work. Let AI capture the details, assign action items, and draft your follow-up emails instantly. Transform meeting chaos into clear, actionable insights.",
    heroImage: "https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/hero-professional-ibHHckLxZhPsRUN6hEdsTW.webp",
    painPoints: [
      { title: "Time Wasted on Admin", desc: "Hours spent writing follow-ups and tracking action items." },
      { title: "Lost Context", desc: "Forgetting key decisions from past meetings." },
      { title: "Misaligned Teams", desc: "No single source of truth for meeting outcomes." }
    ],
    solutions: [
      { title: "Executive Summaries", desc: "Instant AI-generated summaries with key decisions and deadlines." },
      { title: "Auto Action Items", desc: "AI identifies and assigns tasks with deadlines." },
      { title: "Email Drafts", desc: "AI writes follow-ups, client emails, and project briefs in seconds." }
    ],
    pricingTier: "Pro (Professional)",
    pricingPrice: "$9.99 - $14.99",
    pricingFeatures: [
      "Unlimited recording hours",
      "Executive summaries",
      "Auto-assigned action items",
      "Email draft generation",
      "Slack & Calendar integration"
    ]
  };

  const content = audience === "student" ? studentContent : professionalContent;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled ? "bg-background/95 backdrop-blur-md shadow-sm border-b border-border" : "bg-transparent"
        }`}
      >
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/scribesyncs-logo-myaZdb94CzsaGY5RkidZFa.webp"
              alt="ScribeSync AI"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              ScribeSync AI
            </span>
          </div>

          {/* Audience Toggle */}
          <div className="flex items-center gap-2 bg-secondary rounded-full p-1">
            <button
              onClick={() => setAudience("student")}
              className={`px-4 py-2 rounded-full font-medium transition-all ${
                audience === "student"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-foreground hover:bg-secondary/50"
              }`}
            >
              For Students
            </button>
            <button
              onClick={() => setAudience("professional")}
              className={`px-4 py-2 rounded-full font-medium transition-all ${
                audience === "professional"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-foreground hover:bg-secondary/50"
              }`}
            >
              For Professionals
            </button>
          </div>

          <Button 
            onClick={() => window.location.href = getLoginUrl()}
            className="bg-accent hover:bg-accent/90 text-primary font-semibold"
          >
            Sign In
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 overflow-hidden relative">
        <div className="absolute inset-0 -z-10 opacity-30">
          <div className="absolute top-20 right-20 w-96 h-96 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-10 w-80 h-80 bg-gradient-to-tr from-accent/20 to-primary/10 rounded-full blur-3xl" />
        </div>

        <div className="container grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Text */}
          <div className="space-y-6">
            <h1 className="text-5xl lg:text-6xl font-bold leading-tight">
              {content.headline}
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              {content.description}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button 
                size="lg" 
                onClick={() => window.location.href = getLoginUrl()}
                className="bg-accent hover:bg-accent/90 text-primary font-semibold group"
              >
                {content.cta}
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                className="border-2 border-primary text-primary hover:bg-primary/5"
                onClick={() => navigate("/demo")}
              >
                See It in Action
              </Button>
            </div>

            {/* Social Proof */}
            <div className="flex items-center gap-6 pt-4">
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent border-2 border-background flex items-center justify-center text-white text-sm font-bold"
                  >
                    {i}
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold">5,000+ Active Users</p>
                <p className="text-sm text-muted-foreground">Transforming their learning & productivity</p>
              </div>
            </div>
          </div>

          {/* Right: Hero Image */}
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl blur-2xl" />
            <img
              src={content.heroImage}
              alt="Hero"
              className="relative rounded-2xl shadow-2xl w-full h-auto object-cover"
            />
          </div>
        </div>
      </section>

      {/* Pain Points Section */}
      <section className="py-20 bg-secondary/30">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">The Problem You Know Too Well</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {audience === "student"
                ? "Students today face unprecedented information overload. Traditional note-taking doesn't cut it anymore."
                : "Professionals lose hours to admin work. Meetings generate chaos, not clarity."}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {content.painPoints.map((point, i) => (
              <Card key={i} className="p-8 border-2 border-border hover:border-accent/50 transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4">
                  <span className="text-lg font-bold text-primary">{i + 1}</span>
                </div>
                <h3 className="text-xl font-bold mb-2">{point.title}</h3>
                <p className="text-muted-foreground">{point.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Three-Phase Feature Breakdown */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">How ScribeSync AI Works</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Three powerful phases: Capture, Comprehend, Apply
            </p>
          </div>

          {/* Phase 1: Capture */}
          <div className="mb-20 grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-block px-4 py-2 rounded-full bg-primary/10 text-primary font-semibold mb-4">
                Phase 1: Capture
              </div>
              <h3 className="text-3xl font-bold mb-4">Record Everything, Perfectly</h3>
              <p className="text-lg text-muted-foreground mb-6">
                {audience === "student"
                  ? "ScribeSync works seamlessly on your phone or laptop. Record lectures in noisy halls, capture video calls, or upload existing audio. Our AI automatically separates speakers and creates a readable transcript."
                  : "Works across Zoom, Teams, Google Meet, and in-person meetings. Smart speaker diarization automatically distinguishes between participants. Live bookmarking lets you flag important moments."}
              </p>
              <ul className="space-y-3">
                {["Omnichannel recording", "Smart speaker separation", "Live bookmarking"].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-accent" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/feature-capture-Bv9NwLuu9XrqWeGnC95RXj.webp"
                alt="Capture Phase"
                className="rounded-2xl shadow-lg w-full h-auto"
              />
            </div>
          </div>

          {/* Phase 2: Comprehend */}
          <div className="mb-20 grid lg:grid-cols-2 gap-12 items-center lg:grid-flow-dense">
            <div className="relative">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/feature-comprehend-d8f324oXy58nC8fmvuHeX5.webp"
                alt="Comprehend Phase"
                className="rounded-2xl shadow-lg w-full h-auto"
              />
            </div>
            <div>
              <div className="inline-block px-4 py-2 rounded-full bg-accent/10 text-accent font-semibold mb-4">
                Phase 2: Comprehend
              </div>
              <h3 className="text-3xl font-bold mb-4">Turn Chaos into Clarity</h3>
              <p className="text-lg text-muted-foreground mb-6">
                {audience === "student"
                  ? "Instantly get Key Concepts, Formulas, and Reading Assignments. Our AI creates a searchable knowledge base that connects ideas across multiple lectures, building your personal second brain."
                  : "Get Executive Summaries, Action Items, and Deadlines. The AI understands context and creates a knowledge base that connects decisions across meetings, so you never lose track of what matters."}
              </p>
              <ul className="space-y-3">
                {audience === "student"
                  ? ["Adaptive summarization", "Knowledge base integration", "Cross-lecture connections"].map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-accent" />
                        <span>{feature}</span>
                      </li>
                    ))
                  : ["Executive summaries", "Auto-assigned action items", "Decision tracking"].map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-accent" />
                        <span>{feature}</span>
                      </li>
                    ))}
              </ul>
            </div>
          </div>

          {/* Phase 3: Apply */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-block px-4 py-2 rounded-full bg-orange-100 text-orange-700 font-semibold mb-4">
                Phase 3: Apply
              </div>
              <h3 className="text-3xl font-bold mb-4">
                {audience === "student" ? "Study Smarter, Ace Your Exams" : "Execute Faster, Lead Better"}
              </h3>
              <p className="text-lg text-muted-foreground mb-6">
                {audience === "student"
                  ? "Chat with your AI tutor anytime. Ask questions, get Socratic guidance, and auto-generate flashcards, practice quizzes, and study guides—all grounded in your professor's exact words."
                  : "Draft emails, project briefs, and follow-up agendas in seconds. The AI understands your meeting context and generates professional, ready-to-send documents."}
              </p>
              <ul className="space-y-3">
                {audience === "student"
                  ? ["Interactive AI tutor", "Auto-generated flashcards", "Practice quizzes"].map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-accent" />
                        <span>{feature}</span>
                      </li>
                    ))
                  : ["Email draft generation", "Project brief automation", "Follow-up agenda creation"].map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-accent" />
                        <span>{feature}</span>
                      </li>
                    ))}
              </ul>
            </div>
            <div className="relative">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/feature-apply-awes3VCpYxo86nnqsmAAaQ.webp"
                alt="Apply Phase"
                className="rounded-2xl shadow-lg w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-lg text-muted-foreground">
              {audience === "student"
                ? "Students are tight on money. We get it. Start free, upgrade when you're ready."
                : "Scale with your team. Pay only for what you use."}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Free Tier */}
            <Card className="p-8 border-2 border-border">
              <h3 className="text-2xl font-bold mb-2">Basic</h3>
              <p className="text-muted-foreground mb-6">Perfect for getting started</p>
              <div className="mb-6">
                <span className="text-4xl font-bold">Free</span>
                <span className="text-muted-foreground ml-2">/ month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-3">
                  <Check className="w-5 h-5 text-accent" />
                  <span>10 hours recording/month</span>
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-5 h-5 text-accent" />
                  <span>Basic transcription</span>
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-5 h-5 text-accent" />
                  <span>Text summaries</span>
                </li>
              </ul>
              <Button 
                variant="outline" 
                className="w-full border-2 border-primary text-primary"
                onClick={() => window.location.href = getLoginUrl()}
              >
                Start Free
              </Button>
            </Card>

            {/* Pro Tier */}
            <Card className="p-8 border-2 border-accent bg-gradient-to-br from-accent/5 to-primary/5 relative">
              <div className="absolute top-4 right-4 bg-accent text-primary px-3 py-1 rounded-full text-sm font-bold">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold mb-2">{content.pricingTier}</h3>
              <p className="text-muted-foreground mb-6">Everything you need to succeed</p>
              <div className="mb-6">
                <span className="text-4xl font-bold">{content.pricingPrice}</span>
                <span className="text-muted-foreground ml-2">/ month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {content.pricingFeatures.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-accent" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button 
                className="w-full bg-accent hover:bg-accent/90 text-primary font-semibold"
                onClick={() => navigate("/billing")}
              >
                Upgrade Now
              </Button>
            </Card>
          </div>

          {audience === "student" && (
            <div className="mt-12 p-8 rounded-2xl bg-secondary/50 border-2 border-border text-center">
              <h4 className="text-xl font-bold mb-2">Campus Plan</h4>
              <p className="text-muted-foreground">
                Your university can provide ScribeSync Pro to all students as an accessibility aid. Talk to your student government.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Trust & Security Section */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Built with Trust & Privacy in Mind</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Your data is yours. We never sell it, share it, or use it to train models without your consent.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Shield, title: "End-to-End Encryption", desc: "Your recordings are encrypted in transit and at rest." },
              { icon: Users, title: "Consent Management", desc: "Built-in tools to notify participants and manage consent." },
              { icon: BarChart3, title: "Hallucination Guardrails", desc: "AI grounds answers in your actual lecture content." }
            ].map((item, i) => (
              <Card key={i} className="p-8 text-center border-2 border-border hover:border-accent/50 transition-colors">
                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-muted-foreground">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-primary via-accent to-primary text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-96 h-96 bg-white rounded-full blur-3xl" />
        </div>
        <div className="container relative z-10 text-center">
          <h2 className="text-4xl lg:text-5xl font-bold mb-6">
            {audience === "student" ? "Ready to Transform Your Learning?" : "Ready to Reclaim Your Time?"}
          </h2>
          <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
            {audience === "student"
              ? "Join thousands of students who are studying smarter, not harder."
              : "Join professionals who've automated their admin work and reclaimed hours every week."}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              onClick={() => window.location.href = getLoginUrl()}
              className="bg-white text-primary hover:bg-white/90 font-semibold group"
            >
              {content.cta}
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="border-2 border-white text-white hover:bg-white/10"
              onClick={() => navigate("/demo")}
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img
                  src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/scribesyncs-logo-myaZdb94CzsaGY5RkidZFa.webp"
                  alt="ScribeSync AI"
                  className="w-6 h-6"
                />
                <span className="font-bold">ScribeSync AI</span>
              </div>
              <p className="text-sm text-muted-foreground">Transform lectures and meetings into learning and action.</p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Features</a></li>
                <li><a href="#" className="hover:text-foreground">Pricing</a></li>
                <li><a href="#" className="hover:text-foreground">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">About</a></li>
                <li><a href="#" className="hover:text-foreground">Blog</a></li>
                <li><a href="#" className="hover:text-foreground">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Privacy</a></li>
                <li><a href="#" className="hover:text-foreground">Terms</a></li>
                <li><a href="#" className="hover:text-foreground">Cookies</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 text-center text-sm text-muted-foreground">
            <p>&copy; 2026 ScribeSync AI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
