import { Link } from "wouter";
import { useSignupMode } from "@/lib/signupMode";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { useI18n } from "@/i18n";

const FAQ = ["accuracy", "privacy", "delete", "consent", "youtube", "languages", "free"] as const;

export function Faq() {
  const { t } = useI18n();
  return (
    <section id="faq" className="scroll-mt-24 py-32">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{t("landing.faq.title")}</h2>
        <Accordion type="single" collapsible className="mt-10">
          {FAQ.map((id) => (
            <AccordionItem key={id} value={id}>
              <AccordionTrigger className="text-left text-base">{t(`landing.faq.${id}.q`)}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{t(`landing.faq.${id}.a`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function FinalCta() {
  const signup = useSignupMode();
  const { t } = useI18n();
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="mx-auto max-w-5xl rounded-xl bg-primary px-6 py-16 text-center text-primary-foreground sm:px-12">
        <h2 className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-6xl">{t("landing.cta.title")}</h2>
        <p className="mx-auto mt-4 max-w-lg text-primary-foreground/90">{t("landing.cta.text")}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={signup.href} className="whitespace-nowrap rounded-md bg-background px-7 py-3.5 text-base font-semibold text-primary transition-[filter,transform] hover:brightness-95 active:scale-[0.98]">
            {signup.label}
          </Link>
          <Link href="/demo" className="whitespace-nowrap rounded-md border border-white/40 px-7 py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-white/10">
            {t("landing.watchDemo")}
          </Link>
        </div>
      </div>
    </section>
  );
}
