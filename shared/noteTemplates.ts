/**
 * Prompt presets for "Generate notes". The id is stored in the note's metadata
 * so the notes tab can label what each note is; `noteType` maps onto the
 * existing studyNotes.type enum, so no migration is needed to add a template.
 */
export type NoteTemplateId =
  | "lecture"
  | "lab"
  | "seminar"
  | "meeting"
  | "interview"
  | "cornell"
  | "revision"
  | "problem_solving"
  | "language"
  | "research_talk"
  | "one_on_one";

/** Groups in the templates gallery. */
export type NoteTemplateCategory = "study" | "meetings" | "research";
export const NOTE_TEMPLATE_CATEGORIES: Array<{ id: NoteTemplateCategory; label: string; description: string }> = [
  { id: "study", label: "Classes and revision", description: "Lectures, labs, problem classes and exam prep." },
  { id: "meetings", label: "Meetings", description: "Team meetings, one-to-ones and interviews." },
  { id: "research", label: "Talks and research", description: "Seminars, research talks and discussions." },
];

export type NoteTemplate = {
  id: NoteTemplateId;
  label: string;
  description: string;
  category: NoteTemplateCategory;
  noteType: "summary" | "key_concepts" | "action_items" | "formulas" | "study_guide";
  instructions: string;
};

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "lecture",
    label: "Lecture notes",
    description: "Key concepts, formulas and what to read next.",
    category: "study",
    noteType: "key_concepts",
    instructions:
      "Create study notes from this lecture. Sections: ## Key Concepts (each with a one or two sentence explanation), ## Formulas and Definitions (only if the lecture has any), ## Examples Used, ## What to Review Next.",
  },
  {
    id: "lab",
    label: "Lab or practical",
    description: "Method, safety points, expected results.",
    category: "study",
    noteType: "key_concepts",
    instructions:
      "Create notes from this lab or practical session. Sections: ## Aim, ## Materials and Setup, ## Method (numbered steps), ## Safety Points, ## Expected Results, ## Questions to Answer in the Write-up.",
  },
  {
    id: "seminar",
    label: "Seminar or discussion",
    description: "Arguments, viewpoints and open questions.",
    category: "research",
    noteType: "summary",
    instructions:
      "Summarise this seminar or discussion. Sections: ## Main Question, ## Arguments Made (attribute each to its speaker when the transcript shows who said it), ## Points of Agreement, ## Points of Disagreement, ## Open Questions.",
  },
  {
    id: "meeting",
    label: "Meeting summary",
    description: "Decisions, action items with owners, deadlines.",
    category: "meetings",
    noteType: "summary",
    instructions:
      "Summarise this meeting. Sections: ## Summary (three sentences at most), ## Decisions, ## Action Items (as a checklist, each with an owner and due date when stated, otherwise 'owner not stated'), ## Deadlines, ## Open Issues.",
  },
  {
    id: "interview",
    label: "Interview",
    description: "Questions asked and the answers given.",
    category: "meetings",
    noteType: "summary",
    instructions:
      "Summarise this interview. Sections: ## Who Was Speaking (roles only, as stated in the transcript), ## Questions and Answers (each question followed by a short summary of the answer), ## Notable Quotes (exact words, at most five), ## Follow-ups.",
  },
  {
    id: "cornell",
    label: "Cornell notes",
    description: "Cue questions beside the notes, then a summary.",
    category: "study",
    noteType: "key_concepts",
    instructions:
      "Write Cornell-style notes from this lecture. Sections: ## Cue Questions (short questions a student would ask to test themselves, one per main idea), ## Notes (the main ideas in order, as concise bullet points that answer the cue questions), ## Summary (four sentences at most, in plain words).",
  },
  {
    id: "revision",
    label: "Exam revision sheet",
    description: "What to know, likely questions and common mistakes.",
    category: "study",
    noteType: "study_guide",
    instructions:
      "Make a one-page exam revision sheet from this class. Sections: ## Must Know (the essentials, as bullet points), ## Likely Exam Questions (with one-line answers), ## Common Mistakes (only ones the speaker warned about or that the material clearly invites), ## Quick Definitions.",
  },
  {
    id: "problem_solving",
    label: "Problem class",
    description: "Worked examples step by step, with the formulas used.",
    category: "study",
    noteType: "formulas",
    instructions:
      "Write notes from this problem-solving class. Sections: ## Formulas and Rules (each with what its symbols mean), ## Worked Examples (each as numbered steps, keeping the numbers used in class), ## Tips and Shortcuts, ## Practice Ideas (similar problems to try, without answers).",
  },
  {
    id: "language",
    label: "Language class",
    description: "New vocabulary, grammar points and example sentences.",
    category: "study",
    noteType: "key_concepts",
    instructions:
      "Write notes from this language class. Sections: ## New Vocabulary (word, meaning, and an example sentence from the class when there is one), ## Grammar Points (each rule with a short example), ## Useful Phrases, ## Pronunciation Notes (only if the class covered any), ## Homework.",
  },
  {
    id: "research_talk",
    label: "Research talk",
    description: "The claim, how it was tested, findings and limits.",
    category: "research",
    noteType: "summary",
    instructions:
      "Summarise this research talk. Sections: ## Main Claim, ## Background, ## Methods, ## Findings (with numbers as stated), ## Limitations and Caveats, ## Questions from the Audience (with the answers given), ## Papers or Sources Mentioned.",
  },
  {
    id: "one_on_one",
    label: "One-to-one",
    description: "Updates, feedback, decisions and next steps for two people.",
    category: "meetings",
    noteType: "summary",
    instructions:
      "Summarise this one-to-one meeting. Sections: ## Updates (by person when the transcript shows who spoke), ## Feedback Given, ## Decisions, ## Next Steps (as a checklist with the owner and date when stated), ## Topics for Next Time.",
  },
];

/**
 * The section headings a template asks for, read from its instructions
 * ("## Key Concepts (each with...)" gives "Key Concepts"); the gallery
 * previews a template with them.
 */
export function templateSections(template: Pick<NoteTemplate, "instructions">): string[] {
  const sections: string[] = [];
  const pattern = /##\s+([^,(.]+?)(?=\s*\(|,|\.|$)/g;
  for (const match of Array.from(template.instructions.matchAll(pattern))) {
    const heading = match[1].trim();
    if (heading && !sections.includes(heading)) sections.push(heading);
  }
  return sections;
}

export function getNoteTemplate(id: string | null | undefined): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find(template => template.id === id);
}

export function defaultNoteTemplate(audience: "student" | "professional" | string | null | undefined): NoteTemplate {
  return getNoteTemplate(audience === "professional" ? "meeting" : "lecture")!;
}

/** Which default a recording's audience uses in the gallery: classes or meetings. */
export function audienceKey(audience: string | null | undefined): "student" | "professional" {
  return audience === "professional" ? "professional" : "student";
}

/** A stored choice from the gallery when it is still a template, otherwise the built-in default. */
export function resolveNoteTemplate(stored: string | null | undefined, audience: string | null | undefined): NoteTemplate {
  return getNoteTemplate(stored) ?? defaultNoteTemplate(audience);
}
