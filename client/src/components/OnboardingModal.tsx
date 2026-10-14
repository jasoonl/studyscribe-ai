import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mic, FileText, Sparkles, ChevronRight, ChevronLeft } from "lucide-react";
import type { MessageKey } from "@shared/i18n";
import { useI18n } from "@/i18n";

const ONBOARDING_KEY = "studyscribe_onboarding_done";

const steps = [
  {
    icon: <Mic className="w-10 h-10 text-blue-500" />,
    title: "tour.step1Title",
    description: "tour.step1Text",
    tip: "tour.step1Tip",
    color: "bg-blue-50",
    dot: "bg-blue-500",
  },
  {
    icon: <FileText className="w-10 h-10 text-primary" />,
    title: "tour.step2Title",
    description: "tour.step2Text",
    tip: "tour.step2Tip",
    color: "bg-brand-mist",
    dot: "bg-primary",
  },
  {
    icon: <Sparkles className="w-10 h-10 text-amber-500" />,
    title: "tour.step3Title",
    description: "tour.step3Text",
    tip: "tour.step3Tip",
    color: "bg-amber-50",
    dot: "bg-amber-500",
  },
] satisfies Array<{ title: MessageKey; description: MessageKey; tip: MessageKey } & Record<string, unknown>>;

export function OnboardingModal() {
  const { t } = useI18n();
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
          <div className="mb-4 inline-flex p-3 bg-white rounded-xl shadow-sm">
            {current.icon}
          </div>
          <DialogTitle className="text-xl font-bold text-foreground mb-2">{t(current.title)}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">{t(current.description)}</DialogDescription>
        </div>

        {/* Bottom section */}
        <div className="px-8 py-5 bg-white">
          <p className="text-xs text-muted-foreground italic mb-5">{t(current.tip)}</p>

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
                  aria-label={t("tour.goToStep", { step: i + 1 })}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={prev} className="gap-1">
                  <ChevronLeft className="w-4 h-4" />
                  {t("tour.back")}
                </Button>
              )}
              <Button size="sm" onClick={next} className="gap-1 bg-blue-600 hover:bg-blue-700 text-white">
                {step < steps.length - 1 ? (
                  <>
                    {t("tour.next")}
                    <ChevronRight className="w-4 h-4" />
                  </>
                ) : (
                  t("tour.start")
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
                {t("tour.skip")}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
