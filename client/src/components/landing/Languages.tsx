import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import Reveal from "./Reveal";

const NAMES = TRANSCRIPTION_LANGUAGES.map((language) => language.label.replace(/ \(.*\)/, ""));

export default function Languages() {
  const loop = [...NAMES, ...NAMES];
  return (
    <section id="languages" className="scroll-mt-24 overflow-hidden py-32">
      <Reveal className="mx-auto max-w-2xl px-4 text-center">
        <h2 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">Transcribe in {NAMES.length} languages</h2>
        <p className="mt-4 text-muted-foreground">Leave it on automatic and the language is detected for you, or pick one when a short clip needs a nudge.</p>
      </Reveal>
      <div className="marquee relative mt-12" aria-label={`Supported languages: ${NAMES.join(", ")}`}>
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" aria-hidden="true" />
        <ul className="marquee-track flex w-max gap-3" aria-hidden="true">
          {loop.map((name, i) => (
            <li key={`${name}-${i}`} className="whitespace-nowrap rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium shadow-sm">
              {name}
            </li>
          ))}
        </ul>
      </div>
      <p className="mx-auto mt-6 max-w-xl px-4 text-center text-sm text-muted-foreground">Cantonese is transcribed as Chinese, because our transcription provider does not offer it separately.</p>
    </section>
  );
}
