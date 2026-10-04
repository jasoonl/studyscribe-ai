import { useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Briefcase, Check, GraduationCap } from "lucide-react";
import Reveal from "./Reveal";

const AUDIENCES = {
  student: {
    label: "Students",
    icon: GraduationCap,
    headline: "Stop copying slides. Start understanding.",
    text: "Listen in class, then let StudyScribe handle the notes. Review with flashcards and quizzes built from your professor's own words.",
    points: ["Study guides generated from the exact lecture", "Flashcards in Learn and Test modes", "A tutor you can question at midnight before an exam"],
    image: "/landing/flashcards.jpg",
  },
  professional: {
    label: "Professionals",
    icon: Briefcase,
    headline: "Leave the meeting with the follow-up already written.",
    text: "Capture decisions while you stay in the conversation, then turn the transcript into summaries and drafts you can send.",
    points: ["Executive summaries and action items", "Email drafts in the tone you choose", "Searchable transcripts of past meetings"],
    image: "/landing/email-drafts.jpg",
  },
} as const;

export default function UseCases() {
  const reduce = useReducedMotion();
  const [who, setWho] = useState<keyof typeof AUDIENCES>("student");
  const content = AUDIENCES[who];

  return (
    <section id="use-cases" className="scroll-mt-24 bg-gradient-to-b from-brand-mist/60 to-background py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="flex flex-col items-center text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Built for the way you work</h2>
          <div role="tablist" aria-label="Choose your use case" className="mt-8 inline-flex rounded-full border border-border bg-card p-1 shadow-sm">
            {(Object.keys(AUDIENCES) as Array<keyof typeof AUDIENCES>).map((key) => {
              const Icon = AUDIENCES[key].icon;
              const on = key === who;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setWho(key)}
                  className="relative flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold"
                >
                  {on && <motion.span layoutId="usecase-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                  <span className={`relative flex items-center gap-2 ${on ? "text-primary-foreground" : "text-foreground/70"}`}>
                    <Icon className="h-4 w-4" />
                    {AUDIENCES[key].label}
                  </span>
                </button>
              );
            })}
          </div>
        </Reveal>

        <AnimatePresence mode="wait">
          <motion.div
            key={who}
            role="tabpanel"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="mt-14 grid items-center gap-10 lg:grid-cols-2"
          >
            <div>
              <h3 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">{content.headline}</h3>
              <p className="mt-4 text-muted-foreground">{content.text}</p>
              <ul className="mt-6 space-y-3">
                {content.points.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <Link href="/request-access" className="mt-8 inline-flex whitespace-nowrap rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md transition-transform hover:-translate-y-0.5 active:scale-[0.98]">
                Get started
              </Link>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/10">
              <img src={content.image} alt="" loading="lazy" className="block w-full" />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
