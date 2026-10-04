import { motion, useReducedMotion } from "motion/react";
import Reveal from "./Reveal";

type Cell = { title: string; text: string; image?: string; alt?: string; className: string; tone: "plain" | "blue" | "mist" };

const CELLS: Cell[] = [
  { title: "Transcripts you can navigate", text: "Speaker labels and timestamps, so a long lecture is never one unreadable block.", image: "/landing/transcript.jpg", alt: "Transcript view", className: "md:col-span-4 md:row-span-2", tone: "plain" },
  { title: "Flashcards, made for you", text: "Export to Quizlet, Anki or Notion.", image: "/landing/flashcards.jpg", alt: "Flashcard deck", className: "md:col-span-2", tone: "blue" },
  { title: "Practice quizzes", text: "Ten questions with instant scoring and explanations.", image: "/landing/quiz.jpg", alt: "Practice quiz", className: "md:col-span-2", tone: "mist" },
  { title: "An AI tutor that knows your lecture", text: "Ask questions and get answers grounded in what was actually said.", image: "/landing/ai-tutor.jpg", alt: "AI tutor chat", className: "md:col-span-3", tone: "plain" },
  { title: "Study guides and email drafts", text: "A structured guide for exams, or a clean summary email for your team.", image: "/landing/study-guide.jpg", alt: "Study guide", className: "md:col-span-3", tone: "mist" },
];

const TONES = {
  plain: "bg-card text-card-foreground",
  blue: "bg-gradient-to-br from-primary to-brand-deep text-primary-foreground",
  mist: "bg-brand-mist text-foreground",
};

export default function FeatureBento() {
  const reduce = useReducedMotion();
  return (
    <section id="features" className="scroll-mt-24 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <h2 className="max-w-xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">Everything you need after the lecture ends</h2>
        </Reveal>
        <div className="mt-12 grid auto-rows-[minmax(14rem,auto)] gap-4 md:grid-cols-6">
          {CELLS.map((cell, i) => (
            <motion.article
              key={cell.title}
              initial={reduce ? false : { opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              whileHover={reduce ? undefined : { y: -4 }}
              className={`group relative flex flex-col overflow-hidden rounded-3xl border border-border p-7 shadow-sm transition-shadow hover:shadow-xl hover:shadow-primary/10 ${TONES[cell.tone]} ${cell.className}`}
            >
              <h3 className="text-xl font-semibold tracking-tight">{cell.title}</h3>
              <p className={`mt-2 max-w-sm text-sm ${cell.tone === "blue" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{cell.text}</p>
              {cell.image && (
                <div className="mt-6 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-md">
                  <img src={cell.image} alt={cell.alt} loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.03]" />
                </div>
              )}
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
