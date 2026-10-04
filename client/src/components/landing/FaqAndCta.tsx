import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import Reveal from "./Reveal";

const FAQ = [
  { q: "How accurate are the transcripts?", a: "Accuracy depends on audio quality, accents and background noise. Clear recordings transcribe well, and you can edit any transcript by hand. AI-generated notes, flashcards and answers can contain mistakes, so check them against your source material." },
  { q: "Who can see my recordings?", a: "Only you, unless you choose to share a recording. Audio is stored with our hosting provider and sent to a transcription provider and an AI provider to produce your results. The Privacy Policy lists each one." },
  { q: "Can I delete my data?", a: "Yes. Settings lets you export everything we hold about you and delete your account, which permanently removes your recordings, transcripts and study materials." },
  { q: "Can I record other people?", a: "Only with permission. Laws about recording conversations differ by place, and you are responsible for getting consent from the people you record and for following your school or employer's rules." },
  { q: "Can I import a YouTube link?", a: "Yes, for videos published under a Creative Commons licence, which allows reuse. Other videos cannot be imported by link, so upload an audio file you have the right to use instead." },
  { q: "Which languages are supported?", a: "Many. Language is detected automatically, or you can choose one. See the full list above." },
  { q: "Is there a free plan?", a: "Yes. The Free plan lets you try every feature with a small recording allowance. Paid plans are coming soon." },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <Reveal>
          <h2 className="text-center text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">Questions, answered</h2>
        </Reveal>
        <Accordion type="single" collapsible className="mt-10">
          {FAQ.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger className="text-left text-base">{item.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary via-primary to-brand-deep px-6 py-16 text-center text-primary-foreground shadow-2xl shadow-primary/30 sm:px-12">
        <div className="aurora-blob pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-sky/40 blur-3xl" aria-hidden="true" />
        <h2 className="relative text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">Your next lecture deserves better notes</h2>
        <p className="relative mx-auto mt-4 max-w-lg text-primary-foreground/80">Try StudyScribe on one recording and see the difference.</p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/request-access" className="whitespace-nowrap rounded-full bg-background px-7 py-3.5 text-base font-semibold text-primary shadow-lg transition-transform hover:-translate-y-0.5 active:scale-[0.98]">
            Get started
          </Link>
          <Link href="/demo" className="whitespace-nowrap rounded-full border border-white/40 px-7 py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-white/10">
            Watch the demo
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
