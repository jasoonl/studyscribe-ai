import { useRef } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowRight, Play } from "lucide-react";

export default function Hero() {
  const reduce = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start 85%", "end 20%"] });
  const rotate = useSpring(useTransform(scrollYProgress, [0, 0.5], reduce ? [0, 0] : [14, 0]), { stiffness: 90, damping: 22 });
  const lift = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [30, -30]);

  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } };

  return (
    <section className="relative overflow-hidden pb-24 pt-32 sm:pt-36">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="aurora-blob absolute -top-24 left-[8%] h-[28rem] w-[28rem] rounded-full bg-primary/25 blur-3xl" />
        <div className="aurora-blob absolute right-[5%] top-10 h-[24rem] w-[24rem] rounded-full bg-brand-sky/30 blur-3xl [animation-delay:-6s]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <motion.h1 {...rise(0)} className="text-balance text-4xl font-bold leading-[1.05] tracking-tighter sm:text-6xl">
            Record the lecture.{" "}
            <span className="bg-gradient-to-r from-primary to-brand-sky bg-clip-text pb-1 text-transparent">Keep the knowledge.</span>
          </motion.h1>
          <motion.p {...rise(0.1)} className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
            StudyScribe turns recordings into transcripts, flashcards, quizzes, and study guides, then tutors you on what you missed.
          </motion.p>
          <motion.div {...rise(0.2)} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/request-access"
              className="group inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98]"
            >
              Get started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card/70 px-7 py-3.5 text-base font-semibold text-foreground backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.98]"
            >
              <Play className="h-4 w-4 fill-current" />
              Watch the demo
            </Link>
          </motion.div>
        </div>

        <motion.div ref={frame} style={{ y: lift, rotateX: rotate, transformPerspective: 1400 }} className="relative mx-auto mt-16 max-w-5xl will-change-transform">
          <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-b from-primary/20 to-brand-sky/10 blur-2xl" aria-hidden="true" />
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/15">
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
