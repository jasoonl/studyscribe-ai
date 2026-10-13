import { describe, expect, it } from "vitest";
import { NOTE_TEMPLATES, NOTE_TEMPLATE_CATEGORIES, getNoteTemplate, resolveNoteTemplate, templateSections } from "@shared/noteTemplates";

describe("note templates gallery", () => {
  it("reads the section headings a template asks for", () => {
    expect(templateSections(getNoteTemplate("lecture")!)).toEqual(["Key Concepts", "Formulas and Definitions", "Examples Used", "What to Review Next"]);
    expect(templateSections(getNoteTemplate("cornell")!)).toEqual(["Cue Questions", "Notes", "Summary"]);
  });

  it("gives every template a unique id, a category and at least three sections", () => {
    const ids = NOTE_TEMPLATES.map(template => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(NOTE_TEMPLATE_CATEGORIES.map(category => category.id));
    for (const template of NOTE_TEMPLATES) {
      expect(categories.has(template.category)).toBe(true);
      expect(templateSections(template).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses a stored default only while it is still a template", () => {
    expect(resolveNoteTemplate("revision", "student").id).toBe("revision");
    expect(resolveNoteTemplate("gone", "student").id).toBe("lecture");
    expect(resolveNoteTemplate(null, "professional").id).toBe("meeting");
  });
});
