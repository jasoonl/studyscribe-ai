import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { t, useI18n } from "@/i18n";

function steps() {
  return [
    { title: t("nav.record.title"), text: t("landing.how.step1Text"), image: "/landing/dashboard.jpg", alt: t("landing.how.step1Alt") },
    { title: t("landing.how.step2Title"), text: t("landing.how.step2Text"), image: "/landing/transcript.jpg", alt: t("landing.how.step2Alt") },
    { title: t("landing.how.step3Title"), text: t("landing.how.step3Text"), image: "/landing/study-notes.jpg", alt: t("landing.how.step3Alt") },
  ];
}

export default function HowItWorks() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  useI18n();
  const STEPS = steps();

  return (
    <section id="how" className="scroll-mt-24 bg-brand-mist/50 py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div>
          <h2 className="max-w-md text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{t("landing.how.title")}</h2>
          <ol className="mt-10 space-y-8 lg:space-y-3">
            {STEPS.map((step, i) => (
              <motion.li
                key={step.image}
                onViewportEnter={() => setActive(i)}
                viewport={{ amount: 0.9, margin: "-30% 0px -30% 0px" }}
                className="lg:min-h-[34vh]"
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className={`w-full rounded-xl border p-6 text-left transition-[border-color,background-color] duration-300 ${
                    active === i ? "border-primary/40 bg-card" : "border-transparent hover:bg-card/60"
                  }`}
                  aria-pressed={active === i}
                >
                  <span className="text-xl font-semibold">{step.title}</span>
                  <span className="mt-2 block text-muted-foreground">{step.text}</span>
                </button>
                {/* Phones have no room for the sticky picture beside the steps, so each step shows its own. */}
                <div className="shadow-apple mt-4 overflow-hidden rounded-xl border border-border bg-card lg:hidden">
                  <img src={step.image} alt={step.alt} width={1600} height={896} loading="lazy" className="block w-full" />
                </div>
              </motion.li>
            ))}
          </ol>
        </div>

        <div className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
          <div className="shadow-apple relative overflow-hidden rounded-xl border border-border bg-card">
            <AnimatePresence mode="wait">
              <motion.img
                key={STEPS[active].image}
                src={STEPS[active].image}
                alt={STEPS[active].alt}
                width={1600}
                height={896}
                loading="lazy"
                className="block w-full"
                initial={reduce ? false : { opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.35 }}
              />
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
