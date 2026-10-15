// Small tiles use "-focus" crops (just the card, taken at phone width by scripts/landing/capture.mjs);
// a whole page shrunk to tile size is unreadable.
import { t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

type Cell = { id: string; image: string; size: [number, number]; className: string; tone: "plain" | "blue" | "mist" };

const CELLS: Cell[] = [
  { id: "transcript", image: "/landing/transcript.jpg", size: [1600, 896], className: "md:col-span-4 md:row-span-2", tone: "plain" },
  { id: "flashcards", image: "/landing/flashcards-focus.jpg", size: [992, 826], className: "md:col-span-2", tone: "blue" },
  { id: "quiz", image: "/landing/quiz-focus.jpg", size: [992, 866], className: "md:col-span-2", tone: "mist" },
  { id: "tutor", image: "/landing/ai-tutor-focus.jpg", size: [992, 1448], className: "md:col-span-3", tone: "plain" },
  { id: "guide", image: "/landing/study-guide-focus.jpg", size: [892, 1436], className: "md:col-span-3", tone: "mist" },
];

const TONES = {
  plain: "bg-card text-card-foreground",
  blue: "bg-primary text-primary-foreground",
  mist: "bg-brand-mist text-foreground",
};

export default function FeatureBento() {
  useI18n();
  return (
    <section id="features" className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="mx-auto max-w-3xl text-balance text-center text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{t("landing.features.title")}</h2>
        <div className="mt-20 grid auto-rows-[minmax(16rem,auto)] gap-5 md:grid-cols-6">
          {CELLS.map((cell) => (
            <article
              key={cell.id}
              className={`flex flex-col overflow-hidden rounded-xl border border-border/60 p-9 ${TONES[cell.tone]} ${cell.className}`}
            >
              <h3 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{t(`landing.features.${cell.id}.title` as MessageKey)}</h3>
              <p className={`mt-3 max-w-sm text-base leading-snug ${cell.tone === "blue" ? "text-primary-foreground/90" : "text-muted-foreground"}`}>{t(`landing.features.${cell.id}.text` as MessageKey)}</p>
              <div className="mt-8 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card max-md:h-72 max-md:flex-none">
                <img src={cell.image} alt={t(`landing.features.${cell.id}.alt` as MessageKey)} width={cell.size[0]} height={cell.size[1]} loading="lazy" className="h-full w-full object-cover object-left-top" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
