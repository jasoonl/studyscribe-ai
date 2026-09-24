import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

type Slide = { image: string; title: string; caption: string };

/**
 * Screens are shown in this order. Each image lives at client/public/demo/<name>.jpg;
 * a slide whose file is missing is skipped, so the walkthrough works with any subset.
 */
export const DEMO_SLIDES: Slide[] = [
  { image: "/demo/add-recording.jpg", title: "Add a lecture your way", caption: "Record live, upload an audio or video file, or paste a link to a talk. Transcription starts automatically." },
  { image: "/demo/transcript.jpg", title: "Accurate, timestamped transcripts", caption: "Every word is transcribed with speaker labels. Click any timestamp to jump to that moment in the audio." },
  { image: "/demo/study-notes.jpg", title: "Study notes in seconds", caption: "Key concepts and summaries are generated from the transcript, ready to review." },
  { image: "/demo/flashcards.jpg", title: "Flashcards, made for you", caption: "Question and answer cards are created automatically, and can be exported to Quizlet, Anki or Notion." },
  { image: "/demo/learn-mode.jpg", title: "Learn mode", caption: "Start with recognition, then graduate to written recall as you build confidence." },
  { image: "/demo/test-mode.jpg", title: "Practice tests", caption: "A mixed-format test built from your flashcards, with answers shown only after you submit." },
  { image: "/demo/quiz.jpg", title: "Practice quizzes", caption: "Ten AI-written questions with instant scoring and explanations." },
  { image: "/demo/study-guide.jpg", title: "Study guides", caption: "A structured guide with an overview, key concepts, and the details that matter." },
  { image: "/demo/ai-tutor.jpg", title: "AI tutor", caption: "Ask questions about your lecture and get answers grounded in what was actually said." },
  { image: "/demo/email-drafts.jpg", title: "Emails and documents", caption: "Turn a lecture into a summary email, a document, or a formal report in the tone you choose." },
  { image: "/demo/dashboard.jpg", title: "Your whole library", caption: "Search, sort and revisit every recording in one place." },
  { image: "/demo/analytics.jpg", title: "Track your progress", caption: "See your recordings, transcripts, flashcards and quizzes at a glance." },
];

const SLIDE_MS = 6000;
const TICK_MS = 100;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function DemoWalkthrough() {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [held, setHeld] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const regionRef = useRef<HTMLDivElement>(null);

  // Keep only the slides whose image actually loads, in their original order.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      DEMO_SLIDES.map(
        (slide) =>
          new Promise<Slide | null>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(slide);
            image.onerror = () => resolve(null);
            image.src = slide.image;
          }),
      ),
    ).then((results) => {
      if (!cancelled) setSlides(results.filter((slide): slide is Slide => slide !== null));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = slides?.length ?? 0;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
      setElapsed(0);
    },
    [count],
  );

  useEffect(() => {
    if (!playing || held || count < 2) return;
    const timer = window.setInterval(() => {
      setElapsed((value) => value + TICK_MS);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, held, count]);

  useEffect(() => {
    if (elapsed >= SLIDE_MS) go(index + 1);
  }, [elapsed, index, go]);

  if (slides === null) {
    return <div className="aspect-video animate-pulse rounded-lg bg-muted" aria-label="Loading demo" />;
  }

  if (slides.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {DEMO_SLIDES.slice(0, 8).map((slide) => (
          <div key={slide.title} className="rounded-lg border border-border p-4">
            <h3 className="font-semibold">{slide.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{slide.caption}</p>
          </div>
        ))}
      </div>
    );
  }

  const slide = slides[index];
  const progress = playing && count > 1 ? Math.min(100, (elapsed / SLIDE_MS) * 100) : 0;

  return (
    <div
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="StudyScribe AI product walkthrough"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(index + 1);
        else if (event.key === "ArrowLeft") go(index - 1);
        else if (event.key === " ") {
          event.preventDefault();
          setPlaying((value) => !value);
        }
      }}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="space-y-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative overflow-hidden rounded-lg border border-border bg-[#f7f6f6] shadow-sm">
        <img
          key={slide.image}
          src={slide.image}
          alt={`${slide.title}: ${slide.caption}`}
          className="aspect-[3420/2042] w-full object-contain object-top"
          draggable={false}
        />
        {count > 1 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10" aria-hidden="true">
            <div className="h-full bg-primary transition-[width] duration-100 ease-linear" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0" aria-live="polite">
          <p className="text-xs font-medium text-muted-foreground">
            {index + 1} of {count}
          </p>
          <h3 className="text-lg font-semibold">{slide.title}</h3>
          <p className="text-sm text-muted-foreground">{slide.caption}</p>
        </div>
        {count > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous slide" onClick={() => go(index - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" aria-label="Next slide" onClick={() => go(index + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="Choose a slide">
          {slides.map((item, position) => (
            <button
              key={item.image}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={`Go to ${item.title}`}
              onClick={() => go(position)}
              className={`h-2 rounded-full transition-all ${position === index ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
