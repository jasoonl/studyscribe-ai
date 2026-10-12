/**
 * Prompt presets for "Generate notes". The id is stored in the note's metadata
 * so the notes tab can label what each note is; `noteType` maps onto the
 * existing studyNotes.type enum, so no migration is needed to add a template.
 */
export type NoteTemplateId = "lecture" | "lab" | "seminar" | "meeting" | "interview";

export type NoteTemplate = {
  id: NoteTemplateId;
  label: string;
  description: string;
  noteType: "summary" | "key_concepts" | "action_items" | "formulas" | "study_guide";
  instructions: string;
};

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "lecture",
    label: "Lecture notes",
    description: "Key concepts, formulas and what to read next.",
    noteType: "key_concepts",
    instructions:
      "Create study notes from this lecture. Sections: ## Key Concepts (each with a one or two sentence explanation), ## Formulas and Definitions (only if the lecture has any), ## Examples Used, ## What to Review Next.",
  },
  {
    id: "lab",
    label: "Lab or practical",
    description: "Method, safety points, expected results.",
    noteType: "key_concepts",
    instructions:
      "Create notes from this lab or practical session. Sections: ## Aim, ## Materials and Setup, ## Method (numbered steps), ## Safety Points, ## Expected Results, ## Questions to Answer in the Write-up.",
  },
  {
    id: "seminar",
    label: "Seminar or discussion",
    description: "Arguments, viewpoints and open questions.",
    noteType: "summary",
    instructions:
      "Summarise this seminar or discussion. Sections: ## Main Question, ## Arguments Made (attribute each to its speaker when the transcript shows who said it), ## Points of Agreement, ## Points of Disagreement, ## Open Questions.",
  },
  {
    id: "meeting",
    label: "Meeting summary",
    description: "Decisions, action items with owners, deadlines.",
    noteType: "summary",
    instructions:
      "Summarise this meeting. Sections: ## Summary (three sentences at most), ## Decisions, ## Action Items (as a checklist, each with an owner and due date when stated, otherwise 'owner not stated'), ## Deadlines, ## Open Issues.",
  },
  {
    id: "interview",
    label: "Interview",
    description: "Questions asked and the answers given.",
    noteType: "summary",
    instructions:
      "Summarise this interview. Sections: ## Who Was Speaking (roles only, as stated in the transcript), ## Questions and Answers (each question followed by a short summary of the answer), ## Notable Quotes (exact words, at most five), ## Follow-ups.",
  },
];

export function getNoteTemplate(id: string | null | undefined): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find(template => template.id === id);
}

export function defaultNoteTemplate(audience: "student" | "professional" | string | null | undefined): NoteTemplate {
  return getNoteTemplate(audience === "professional" ? "meeting" : "lecture")!;
}
