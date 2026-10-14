import { useState } from "react";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { useSignupMode } from "@/lib/signupMode";

const AUDIENCES = {
  student: {
    label: "Students",
    headline: "Stop copying slides. Start understanding.",
    text: "Listen in class, then let StudyScribe handle the notes. Review with flashcards and quizzes built from your professor's own words.",
    points: ["Study guides generated from the exact lecture", "Flashcards in Learn and Test modes", "A tutor you can question at midnight before an exam"],
    image: "/landing/flashcards.jpg",
    alt: "A StudyScribe flashcard from a cell biology lecture, with the question on the front",
  },
  professional: {
    label: "Professionals",
    headline: "Leave the meeting with the follow-up already written.",
    text: "Capture decisions while you stay in the conversation, then turn the transcript into summaries and drafts you can send.",
    points: ["Executive summaries and action items", "Email drafts in the tone you choose", "Searchable transcripts of past meetings"],
    image: "/landing/email-drafts.jpg",
    alt: "A follow-up email drafted by StudyScribe from a product roadmap meeting",
  },
} as const;

const KEYS = Object.keys(AUDIENCES) as Array<keyof typeof AUDIENCES>;

export default function UseCases() {
  const signup = useSignupMode();
  const [who, setWho] = useState<keyof typeof AUDIENCES>("student");
  const content = AUDIENCES[who];

  return (
    <section id="use-cases" className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <h2 className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">Built for the way you work</h2>
          <div role="tablist" aria-label="Choose your use case" className="mt-8 inline-flex rounded-lg border border-border bg-card p-1">
            {KEYS.map((key, index) => {
              const on = key === who;
              return (
                <button
                  key={key}
                  id={`use-case-tab-${key}`}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  aria-controls="use-case-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setWho(key)}
                  onKeyDown={(event) => {
                    // Arrow keys move between tabs, as the ARIA tabs pattern expects.
                    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                    if (!step) return;
                    event.preventDefault();
                    const next = KEYS[(index + step + KEYS.length) % KEYS.length];
                    setWho(next);
                    document.getElementById(`use-case-tab-${next}`)?.focus();
                  }}
                  className={`flex items-center gap-2 rounded-md px-5 py-2 text-sm font-semibold transition-colors ${on ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"}`}
                >
                  {AUDIENCES[key].label}
                </button>
              );
            })}
          </div>
        </div>

        <div role="tabpanel" id="use-case-panel" aria-labelledby={`use-case-tab-${who}`} className="mt-14 grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h3 className="text-balance text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{content.headline}</h3>
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
              <Link href={signup.href} className="mt-8 inline-flex whitespace-nowrap rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]">
                {signup.label}
              </Link>
            </div>
            <div className="shadow-apple overflow-hidden rounded-xl border border-border bg-card">
              <img src={content.image} alt={content.alt} width={1600} height={896} loading="lazy" className="block w-full" />
            </div>
        </div>
      </div>
    </section>
  );
}
