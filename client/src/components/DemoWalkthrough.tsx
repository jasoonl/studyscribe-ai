import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

/** `title` and `caption` are message keys; the walkthrough reads them in the interface language. */
type Slide = { image: string; title: MessageKey; caption: MessageKey };

/**
 * Screens are shown in this order. Each image lives at client/public/demo/<name>.jpg;
 * a slide whose file is missing is skipped, so the walkthrough works with any subset.
 */
export const DEMO_SLIDES: Slide[] = [
  { image: "/demo/add-recording.jpg", title: "demo.slide.add.title", caption: "demo.slide.add.caption" },
  { image: "/demo/transcript.jpg", title: "demo.slide.transcript.title", caption: "demo.slide.transcript.caption" },
  { image: "/demo/study-notes.jpg", title: "demo.slide.notes.title", caption: "demo.slide.notes.caption" },
  { image: "/demo/flashcards.jpg", title: "landing.features.flashcards.title", caption: "demo.slide.flashcards.caption" },
  { image: "/demo/learn-mode.jpg", title: "demo.slide.learn.title", caption: "demo.slide.learn.caption" },
  { image: "/demo/test-mode.jpg", title: "demo.slide.test.title", caption: "demo.slide.test.caption" },
  { image: "/demo/quiz.jpg", title: "landing.features.quiz.title", caption: "demo.slide.quiz.caption" },
  { image: "/demo/study-guide.jpg", title: "demo.slide.guide.title", caption: "demo.slide.guide.caption" },
  { image: "/demo/ai-tutor.jpg", title: "nav.tutor.title", caption: "demo.slide.tutor.caption" },
  { image: "/demo/email-drafts.jpg", title: "demo.slide.email.title", caption: "demo.slide.email.caption" },
  { image: "/demo/dashboard.jpg", title: "demo.slide.library.title", caption: "demo.slide.library.caption" },
  { image: "/demo/analytics.jpg", title: "demo.slide.progress.title", caption: "demo.slide.progress.caption" },
];

/** Rendered by scripts/demo-video/v2 (see CLAUDE.md). */
const DEMO_VIDEO = "/demo/studyscribe-demo.mp4";
/** A frame from the video (22s in), so the player never opens on a black frame. */
const DEMO_POSTER = "/demo/poster.jpg";

const SLIDE_MS = 6000;
const TICK_MS = 100;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function DemoWalkthrough() {
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [held, setHeld] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const regionRef = useRef<HTMLDivElement>(null);
  useI18n();

  // Missing files fall through to the SPA's index.html, so check the type, not just the status.
  useEffect(() => {
    let cancelled = false;
    fetch(DEMO_VIDEO, { method: "HEAD" })
      .then((response) => {
        if (!cancelled) setHasVideo(response.ok && (response.headers.get("content-type") ?? "").startsWith("video/"));
      })
      .catch(() => {
        if (!cancelled) setHasVideo(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (hasVideo === null || slides === null) {
    return <div className="aspect-video animate-pulse rounded-lg bg-muted" aria-label={t("demo.loading")} />;
  }

  if (hasVideo) {
    return (
      <video
        src={DEMO_VIDEO}
        poster={DEMO_POSTER}
        controls
        playsInline
        preload="metadata"
        className="aspect-[1600/1080] w-full rounded-lg border border-border bg-black"
      >
        {t("demo.noVideo")}
      </video>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {DEMO_SLIDES.slice(0, 8).map((slide) => (
          <div key={slide.title} className="rounded-lg border border-border p-4">
            <h3 className="font-semibold">{t(slide.title)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(slide.caption)}</p>
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
      aria-label={t("demo.carousel")}
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
          alt={t("demo.slideAlt", { title: t(slide.title), caption: t(slide.caption) })}
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
            {t("demo.slideOf", { current: index + 1, total: count })}
          </p>
          <h3 className="text-lg font-semibold">{t(slide.title)}</h3>
          <p className="text-sm text-muted-foreground">{t(slide.caption)}</p>
        </div>
        {count > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="icon" aria-label={t("demo.previous")} onClick={() => go(index - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={playing ? t("demo.pause") : t("demo.play")}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" aria-label={t("demo.next")} onClick={() => go(index + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label={t("demo.chooseSlide")}>
          {slides.map((item, position) => (
            <button
              key={item.image}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={t("demo.goTo", { title: t(item.title) })}
              onClick={() => go(position)}
              className={`h-2 rounded-full transition-all ${position === index ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
