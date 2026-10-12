type Cell = { title: string; text: string; image: string; alt: string; className: string; tone: "plain" | "blue" | "mist" };

const CELLS: Cell[] = [
  { title: "Transcripts you can navigate", text: "Speaker labels and timestamps, so a long lecture is never one unreadable block.", image: "/landing/transcript.jpg", alt: "Transcript view", className: "md:col-span-4 md:row-span-2", tone: "plain" },
  { title: "Flashcards, made for you", text: "Export to Quizlet, Anki or Notion.", image: "/landing/flashcards.jpg", alt: "Flashcard deck", className: "md:col-span-2", tone: "blue" },
  { title: "Practice quizzes", text: "Ten questions with instant scoring and explanations.", image: "/landing/quiz.jpg", alt: "Practice quiz", className: "md:col-span-2", tone: "mist" },
  { title: "An AI tutor that knows your lecture", text: "Ask questions and get answers grounded in what was actually said.", image: "/landing/ai-tutor.jpg", alt: "AI tutor chat", className: "md:col-span-3", tone: "plain" },
  { title: "Study guides and email drafts", text: "A structured guide for exams, or a clean summary email for your team.", image: "/landing/study-guide.jpg", alt: "Study guide", className: "md:col-span-3", tone: "mist" },
];

const TONES = {
  plain: "bg-card text-card-foreground",
  blue: "bg-primary text-primary-foreground",
  mist: "bg-brand-mist text-foreground",
};

export default function FeatureBento() {
  return (
    <section id="features" className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="mx-auto max-w-3xl text-balance text-center text-4xl font-bold tracking-[-0.035em] sm:text-6xl">Everything you need after the lecture ends</h2>
        <div className="mt-20 grid auto-rows-[minmax(16rem,auto)] gap-5 md:grid-cols-6">
          {CELLS.map((cell) => (
            <article
              key={cell.title}
              className={`flex flex-col overflow-hidden rounded-xl border border-border/60 p-9 ${TONES[cell.tone]} ${cell.className}`}
            >
              <h3 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{cell.title}</h3>
              <p className={`mt-3 max-w-sm text-base leading-snug ${cell.tone === "blue" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{cell.text}</p>
              <div className="mt-8 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card">
                <img src={cell.image} alt={cell.alt} width={1600} height={896} loading="lazy" className="h-full w-full object-cover object-top" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
