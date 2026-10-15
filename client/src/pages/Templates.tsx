import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPreferredNoteTemplate, setPreferredNoteTemplate } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { t, useI18n } from "@/i18n";
import type { MessageKey } from "@shared/i18n";
import { NOTE_TEMPLATES, NOTE_TEMPLATE_CATEGORIES, resolveNoteTemplate, templateSections, type NoteTemplate } from "@shared/noteTemplates";

type Audience = "student" | "professional";

const templateName = (template: NoteTemplate) => t(`notes.template.${template.id}.name` as MessageKey);
const templateDescription = (template: NoteTemplate) => t(`notes.template.${template.id}.description` as MessageKey);

/** Section headings come from the (English) prompt; show a translation when there is one. */
function sectionName(heading: string) {
  const key = `templates.section.${heading.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}` as MessageKey;
  const text = t(key);
  return text === key ? heading : text;
}

function defaultForLabel(audiences: Audience[]) {
  if (audiences.length > 1) return t("templates.defaultFor.both");
  return t(audiences[0] === "student" ? "templates.defaultFor.student" : "templates.defaultFor.professional");
}

/**
 * Templates gallery: every notes template with the sections it writes, and a
 * default for class recordings and one for meetings. The default is used by
 * automatic notes and preselected in the notes tab (remembered per browser).
 */
export default function Templates() {
  useI18n();
  const [defaults, setDefaults] = useState<Record<Audience, string>>(() => ({
    student: resolveNoteTemplate(getPreferredNoteTemplate("student"), "student").id,
    professional: resolveNoteTemplate(getPreferredNoteTemplate("professional"), "professional").id,
  }));

  const choose = (audience: Audience, template: NoteTemplate) => {
    setPreferredNoteTemplate(audience, template.id);
    setDefaults(current => ({ ...current, [audience]: template.id }));
    toast.success(t(audience === "student" ? "templates.defaultSet.student" : "templates.defaultSet.professional", { template: templateName(template) }));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("common.library")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-5xl pb-20 pt-10" tabIndex={-1}>
        <div className="mb-10 max-w-2xl">
          <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("templates.title")}</h1>
          <p className="mt-3 text-muted-foreground">
            {t("templates.intro")}
          </p>
        </div>

        <div className="space-y-12">
          {NOTE_TEMPLATE_CATEGORIES.map(category => {
            const templates = NOTE_TEMPLATES.filter(template => template.category === category.id);
            if (templates.length === 0) return null;
            return (
              <section key={category.id} aria-labelledby={`templates-${category.id}`}>
                <h2 id={`templates-${category.id}`} className="text-lg font-semibold">{t(`templates.category.${category.id}.label` as MessageKey)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t(`templates.category.${category.id}.description` as MessageKey)}</p>
                <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {templates.map(template => (
                    <TemplateCard key={template.id} template={template} defaults={defaults} onChoose={choose} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function TemplateCard({ template, defaults, onChoose }: { template: NoteTemplate; defaults: Record<Audience, string>; onChoose: (audience: Audience, template: NoteTemplate) => void }) {
  useI18n();
  const sections = templateSections(template);
  const defaultFor = (Object.keys(defaults) as Audience[]).filter(audience => defaults[audience] === template.id);
  return (
    <li className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-sm", defaultFor.length ? "border-primary" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{templateName(template)}</h3>
        {defaultFor.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Check className="h-3 w-3" aria-hidden="true" />
            {defaultForLabel(defaultFor)}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{templateDescription(template)}</p>
      <ol className="mt-4 flex-1 space-y-1.5 border-t border-border pt-4 text-sm" aria-label={t("templates.sectionsIn", { template: templateName(template) })}>
        {sections.map((section, index) => (
          <li key={section} className="flex gap-2.5">
            <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground">{index + 1}</span>
            <span>{sectionName(section)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        {(["student", "professional"] as const).map(audience =>
          defaults[audience] === template.id ? null : (
            <Button key={audience} type="button" size="sm" variant="outline" onClick={() => onChoose(audience, template)}>
              {t(audience === "student" ? "templates.useFor.student" : "templates.useFor.professional")}
            </Button>
          ),
        )}
      </div>
    </li>
  );
}
