import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, ArrowRight, Zap, BookOpen, Briefcase, Users, BarChart3, Shield } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";

/**
 * StudyScribe AI — Marketing Landing Page
 * Public page for unauthenticated users
 */

type Audience = "student" | "professional";

export default function Landing() {
  const [, navigate] = useLocation();
  const [audience, setAudience] = useState<Audience>("student");
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const studentContent = {
    headline: "From Lecture to Mastery.",
    subheading: "AI-powered study tools that learn with you.",
    cta: "Start Learning Smarter",
    description: "Stop stressing about what you missed in lecture. StudyScribe AI listens, takes perfect notes, and instantly transforms your classes into custom flashcards, practice exams, and a 24/7 personalized AI tutor.",
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
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/studyscribe-logo-YqjarSv2s9a5LtpKjX9CE5.webp"
              alt="StudyScribe AI"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              StudyScribe AI
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

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-primary/10 to-accent/10">
        <div className="container text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to Transform Your Learning?</h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of students and professionals already using StudyScribe AI to study smarter and work faster.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              onClick={() => window.location.href = getLoginUrl()}
              className="bg-accent hover:bg-accent/90 text-primary font-semibold"
            >
              Get Started Free
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              onClick={() => navigate("/demo")}
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="container text-center text-muted-foreground">
          <p>&copy; 2026 StudyScribe AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
