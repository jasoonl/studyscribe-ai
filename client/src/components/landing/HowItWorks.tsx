import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const STEPS = [
  { title: "Record or upload", text: "Record live in your browser, upload an audio or video file, or paste a link. Transcription starts on its own.", image: "/landing/dashboard.jpg", alt: "Adding a new recording" },
  { title: "Read the transcript", text: "Every word comes with timestamps and speaker labels. Click any line to jump to that moment in the audio.", image: "/landing/transcript.jpg", alt: "A timestamped transcript with speaker labels" },
  { title: "Study with AI", text: "Generate notes, flashcards, practice quizzes and study guides, then ask the tutor about anything in your lecture.", image: "/landing/study-notes.jpg", alt: "AI-generated study notes" },
];

export default function HowItWorks() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  return (
    <section id="how" className="scroll-mt-24 bg-brand-mist/50 py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div>
          <h2 className="max-w-md text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">From a recording to a study plan in minutes</h2>
          <ol className="mt-10 space-y-3">
            {STEPS.map((step, i) => (
              <motion.li
                key={step.title}
                onViewportEnter={() => setActive(i)}
                viewport={{ amount: 0.9, margin: "-30% 0px -30% 0px" }}
                className="lg:min-h-[34vh]"
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className={`w-full rounded-2xl border p-6 text-left transition-all duration-300 ${
                    active === i ? "border-primary/40 bg-card shadow-lg shadow-primary/10" : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                  aria-current={active === i}
                >
                  <span className="text-xl font-semibold">{step.title}</span>
                  <span className="mt-2 block text-muted-foreground">{step.text}</span>
                </button>
              </motion.li>
            ))}
          </ol>
        </div>

        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
            <AnimatePresence mode="wait">
              <motion.img
                key={STEPS[active].image}
                src={STEPS[active].image}
                alt={STEPS[active].alt}
                width={1600}
                height={1080}
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
