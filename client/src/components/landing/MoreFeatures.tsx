import { t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

/** Each id names its messages: `landing.more.<group>.title|intro` and `landing.more.<item>.name|text`. */
const GROUPS: Array<{ id: string; items: string[] }> = [
  { id: "during", items: ["live", "help", "captions", "slides", "notetaker"] },
  { id: "after", items: ["courses", "ask", "tasks", "chapters", "exam", "templates"] },
  { id: "together", items: ["roles", "comments", "teams"] },
  { id: "everywhere", items: ["apps", "connected", "api"] },
];

const m = (key: string) => t(`landing.more.${key}` as MessageKey);

/** The features added since launch, as plain grouped lists (no icon grid). */
export default function MoreFeatures() {
  useI18n();
  return (
    <section id="more-features" aria-labelledby="more-features-heading" className="scroll-mt-24 border-t border-border/60 py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 id="more-features-heading" className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-5xl">{m("title")}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{m("intro")}</p>
        </div>
        <div className="mt-16 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {GROUPS.map(group => (
            <div key={group.id}>
              <h3 className="text-xl font-semibold tracking-[-0.02em]">{m(`${group.id}.title`)}</h3>
              <p className="mt-2 text-muted-foreground">{m(`${group.id}.intro`)}</p>
              <dl className="mt-6 divide-y divide-border/70 border-y border-border/70">
                {group.items.map(item => (
                  <div key={item} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt className="font-medium">{m(`${item}.name`)}</dt>
                    <dd className="text-muted-foreground">{m(`${item}.text`)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
