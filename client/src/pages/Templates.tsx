import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPreferredNoteTemplate, setPreferredNoteTemplate } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { NOTE_TEMPLATES, NOTE_TEMPLATE_CATEGORIES, resolveNoteTemplate, templateSections, type NoteTemplate } from "@shared/noteTemplates";

type Audience = "student" | "professional";

const AUDIENCE_LABEL: Record<Audience, string> = { student: "classes", professional: "meetings" };

/**
 * Templates gallery: every notes template with the sections it writes, and a
 * default for class recordings and one for meetings. The default is used by
 * automatic notes and preselected in the notes tab (remembered per browser).
 */
export default function Templates() {
  const [defaults, setDefaults] = useState<Record<Audience, string>>(() => ({
    student: resolveNoteTemplate(getPreferredNoteTemplate("student"), "student").id,
    professional: resolveNoteTemplate(getPreferredNoteTemplate("professional"), "professional").id,
  }));

  const choose = (audience: Audience, template: NoteTemplate) => {
    setPreferredNoteTemplate(audience, template.id);
    setDefaults(current => ({ ...current, [audience]: template.id }));
    toast.success(`${template.label} is now the default for ${AUDIENCE_LABEL[audience]}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Library
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container max-w-5xl pb-20 pt-10" tabIndex={-1}>
        <div className="mb-10 max-w-2xl">
          <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Note templates</h1>
          <p className="mt-3 text-muted-foreground">
            Each template shapes the notes StudyScribe writes from a transcript. Pick a default for class recordings and one for meetings; you can still choose any template on a recording's Notes tab.
          </p>
        </div>

        <div className="space-y-12">
          {NOTE_TEMPLATE_CATEGORIES.map(category => {
            const templates = NOTE_TEMPLATES.filter(template => template.category === category.id);
            if (templates.length === 0) return null;
            return (
              <section key={category.id} aria-labelledby={`templates-${category.id}`}>
                <h2 id={`templates-${category.id}`} className="text-lg font-semibold">{category.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>
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
  const sections = templateSections(template);
  const defaultFor = (Object.keys(defaults) as Audience[]).filter(audience => defaults[audience] === template.id);
  return (
    <li className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-sm", defaultFor.length ? "border-primary" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{template.label}</h3>
        {defaultFor.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Check className="h-3 w-3" aria-hidden="true" />
            Default for {defaultFor.map(audience => AUDIENCE_LABEL[audience]).join(" and ")}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
      <ol className="mt-4 flex-1 space-y-1.5 border-t border-border pt-4 text-sm" aria-label={`Sections in ${template.label}`}>
        {sections.map((section, index) => (
          <li key={section} className="flex gap-2.5">
            <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground">{index + 1}</span>
            <span>{section}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        {(["student", "professional"] as const).map(audience =>
          defaults[audience] === template.id ? null : (
            <Button key={audience} type="button" size="sm" variant="outline" onClick={() => onChoose(audience, template)}>
              Use for {AUDIENCE_LABEL[audience]}
            </Button>
          ),
        )}
      </div>
    </li>
  );
}
