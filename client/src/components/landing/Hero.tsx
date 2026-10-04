import { useRef } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  const reduce = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start 85%", "end 20%"] });
  const rotate = useSpring(useTransform(scrollYProgress, [0, 0.5], reduce ? [0, 0] : [14, 0]), { stiffness: 90, damping: 22 });
  const lift = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [30, -30]);

  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } };

  return (
    <section className="relative overflow-hidden pb-28 pt-36 sm:pt-44">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="aurora-blob absolute -top-24 left-[8%] h-[28rem] w-[28rem] rounded-full bg-primary/25 blur-3xl" />
        <div className="aurora-blob absolute right-[5%] top-10 h-[24rem] w-[24rem] rounded-full bg-brand-sky/30 blur-3xl [animation-delay:-6s]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-4xl text-center">
          <motion.h1 {...rise(0)} className="text-balance text-5xl font-bold leading-[1.03] tracking-[-0.04em] sm:text-7xl lg:text-8xl">
            Record the lecture.{" "}
            <span className="bg-gradient-to-r from-primary to-brand-sky bg-clip-text pb-1 text-transparent">Keep the knowledge.</span>
          </motion.h1>
          <motion.p {...rise(0.1)} className="mx-auto mt-8 max-w-2xl text-pretty text-xl leading-snug text-muted-foreground sm:text-2xl">
            StudyScribe turns recordings into transcripts, flashcards, quizzes, and study guides, then tutors you on what you missed.
          </motion.p>
          <motion.div {...rise(0.2)} className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/request-access"
              className="group inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Get started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-3.5 text-base font-medium text-primary transition-all hover:underline active:scale-[0.98]"
            >
              Watch the demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        </div>

        <motion.div ref={frame} style={{ y: lift, rotateX: rotate, transformPerspective: 1400 }} className="relative mx-auto mt-20 max-w-6xl will-change-transform">
          <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-b from-primary/20 to-brand-sky/10 blur-2xl" aria-hidden="true" />
          <div className="shadow-apple overflow-hidden rounded-[1.75rem] border border-border/70 bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-4 py-3" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
            </div>
            <img src="/landing/dashboard.jpg" alt="The StudyScribe dashboard showing a library of recordings" className="block w-full" width={1600} height={1080} fetchPriority="high" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
