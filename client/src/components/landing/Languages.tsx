import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import { htmlLangFor, type UiLanguage } from "@shared/i18n";
import { t, useI18n } from "@/i18n";

const ENGLISH_NAMES = TRANSCRIPTION_LANGUAGES.map((language) => language.label.replace(/ \(.*\)/, ""));

/** Language names in the interface language (Intl.DisplayNames), which calls "tl" Filipino, so Tagalog has its own message. */
function languageNames(ui: UiLanguage) {
  if (ui === "en") return ENGLISH_NAMES;
  const locale = htmlLangFor(ui);
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    return ENGLISH_NAMES;
  }
  return TRANSCRIPTION_LANGUAGES.map((language, i) => {
    if (language.code === "tl") return t("landing.languages.tagalog");
    const name = display?.of(language.code) ?? ENGLISH_NAMES[i];
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  });
}

const CHIP = "whitespace-nowrap rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium";

export default function Languages() {
  const reduce = useReducedMotion();
  const { language } = useI18n();
  const NAMES = languageNames(language);
  // Moving content needs a way to stop it (WCAG 2.2.2): hover pauses for mice, this button for everyone else.
  const [paused, setPaused] = useState(false);
  const loop = [...NAMES, ...NAMES];
  return (
    <section id="languages" className="scroll-mt-24 overflow-hidden py-32">
      <div className="mx-auto max-w-2xl px-4 text-center">
        <h2 className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{t("landing.languages.title", { count: NAMES.length })}</h2>
        <p className="mt-4 text-muted-foreground">{t("landing.languages.text")}</p>
      </div>
      {reduce ? (
        <ul className="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-3 px-4">
          {NAMES.map((name) => (
            <li key={name} className={CHIP}>{name}</li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="sr-only">
            {NAMES.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <div className={`marquee relative mt-12 ${paused ? "is-paused" : ""}`} aria-hidden="true">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" />
            <ul className="marquee-track flex w-max gap-3">
              {loop.map((name, i) => (
                <li key={`${name}-${i}`} className={CHIP}>{name}</li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
              {paused ? t("landing.languages.resume") : t("landing.languages.pause")}
            </button>
          </div>
        </>
      )}
      <p className="mx-auto mt-6 max-w-xl px-4 text-center text-sm text-muted-foreground">{t("landing.languages.cantonese")}</p>
    </section>
  );
}
