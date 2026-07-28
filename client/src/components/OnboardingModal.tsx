import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mic, FileText, Sparkles, ChevronRight, ChevronLeft, X } from "lucide-react";

const ONBOARDING_KEY = "studyscribe_onboarding_done";

const steps = [
  {
    icon: <Mic className="w-10 h-10 text-blue-500" />,
    title: "Record or Upload",
    description:
      "Use the built-in recorder to capture lectures and meetings live, or upload an existing audio file (MP3, WAV, M4A, WebM). StudyScribe AI handles the rest.",
    tip: "Tip: You can record directly from your browser — no app needed.",
    color: "bg-blue-50",
    dot: "bg-blue-500",
  },
  {
    icon: <FileText className="w-10 h-10 text-purple-500" />,
    title: "Get Your Transcript",
    description:
      "Your audio is automatically transcribed using AI. Review and edit the transcript, then explore key insights, action items, and summaries generated for you.",
    tip: "Tip: Transcription usually takes 1–2 minutes for a 30-minute recording.",
    color: "bg-purple-50",
    dot: "bg-purple-500",
  },
  {
    icon: <Sparkles className="w-10 h-10 text-amber-500" />,
    title: "Study Smarter with AI",
    description:
      "Generate study guides, practice quizzes, email drafts, and flashcards from any recording. Use the AI Assistant to ask questions about your content.",
    tip: "Tip: Try the Knowledge Base to search across all your transcripts at once.",
    color: "bg-amber-50",
    dot: "bg-amber-500",
  },
];

export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) {
      // Slight delay so the dashboard loads first
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setOpen(false);
  };

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      dismiss();
    }
  };

  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  const current = steps[step];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl">
        {/* Top color band */}
        <div className={`${current.color} px-8 pt-8 pb-6 transition-colors duration-300`}>
          <div className="flex items-start justify-between mb-4">
            <div className="p-3 bg-white rounded-xl shadow-sm">
              {current.icon}
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">{current.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{current.description}</p>
        </div>

        {/* Bottom section */}
        <div className="px-8 py-5 bg-white">
          <p className="text-xs text-muted-foreground italic mb-5">{current.tip}</p>

          {/* Step dots */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {steps.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`w-2 h-2 rounded-full transition-all duration-200 ${
                    i === step ? `${s.dot} w-5` : "bg-gray-200"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={prev} className="gap-1">
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
              <Button size="sm" onClick={next} className="gap-1 bg-blue-600 hover:bg-blue-700 text-white">
                {step < steps.length - 1 ? (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </>
                ) : (
                  "Get Started"
                )}
              </Button>
            </div>
          </div>

          {/* Skip link */}
          {step < steps.length - 1 && (
            <div className="text-center mt-3">
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
              >
                Skip tour
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
