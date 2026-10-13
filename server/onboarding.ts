import { and, desc, eq } from "drizzle-orm";
import { chatHistory, courses, flashcards, recordings, studyNotes } from "../drizzle/schema";
import { getDb } from "./db";
import { tolerateMissingSchema } from "./schemaTolerance";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Dashboard "Get set up" checklist (F5). Every step is read from what the
 * person has actually done, so it ticks itself off; nothing here is stored.
 */

export type OnboardingFacts = {
  recordings: number;
  /** Most recent finished recording, for the steps that happen on a recording's page. */
  latestCompletedRecordingId: number | null;
  notes: number;
  flashcards: number;
  courses: number;
  questions: number;
};

export type OnboardingStep = {
  id: "record" | "notes" | "flashcards" | "course" | "ask";
  title: string;
  detail: string;
  done: boolean;
  /** Where the step's button goes; "recorder" and "course" are handled on the dashboard itself. */
  action: { kind: "link"; href: string; label: string } | { kind: "recorder"; label: string } | { kind: "course"; label: string };
};

export function buildChecklist(facts: OnboardingFacts): { steps: OnboardingStep[]; done: number; total: number } {
  const recordingHref = facts.latestCompletedRecordingId ? `/recording/${facts.latestCompletedRecordingId}` : null;
  const steps: OnboardingStep[] = [
    {
      id: "record",
      title: "Record or upload your first lecture",
      detail: "Record in the browser, upload a file, or paste a link.",
      done: facts.recordings > 0,
      action: { kind: "recorder", label: "Start" },
    },
    {
      id: "notes",
      title: "Generate study notes",
      detail: recordingHref ? "Open a transcribed recording and pick a note template." : "Notes are written once a transcript is ready. Meanwhile, choose how they look.",
      done: facts.notes > 0,
      action: recordingHref ? { kind: "link", href: recordingHref, label: "Open recording" } : { kind: "link", href: "/templates", label: "See templates" },
    },
    {
      id: "flashcards",
      title: "Try flashcards",
      detail: "Turn a transcript into cards and review them.",
      done: facts.flashcards > 0,
      action: recordingHref ? { kind: "link", href: recordingHref, label: "Open recording" } : { kind: "recorder", label: "Record first" },
    },
    {
      id: "course",
      title: "Create a course",
      detail: "Group recordings by class so they are easy to find.",
      done: facts.courses > 0,
      action: { kind: "course", label: "New course" },
    },
    {
      id: "ask",
      title: "Ask a question",
      detail: "Ask StudyScribe about anything said in your recordings.",
      done: facts.questions > 0,
      action: { kind: "link", href: "/ask", label: "Ask" },
    },
  ];
  return { steps, done: steps.filter((step) => step.done).length, total: steps.length };
}

async function countRows(feature: string, work: () => Promise<unknown[]>) {
  return (await tolerateMissingSchema(feature, work, [])).length;
}

export const onboardingRouter = router({
  checklist: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return buildChecklist({ recordings: 0, latestCompletedRecordingId: null, notes: 0, flashcards: 0, courses: 0, questions: 0 });
    const userId = ctx.user.id;
    // Existence checks only (limit 1); the checklist needs "any", not totals.
    const [recordingCount, latest, notes, cards, courseCount, questions] = await Promise.all([
      countRows("onboarding", () => db.select({ id: recordings.id }).from(recordings).where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0))).limit(1)),
      db
        .select({ id: recordings.id })
        .from(recordings)
        .where(and(eq(recordings.userId, userId), eq(recordings.isDeleted, 0), eq(recordings.status, "completed")))
        .orderBy(desc(recordings.createdAt))
        .limit(1),
      // Key terms and chapters are also studyNotes rows (metadata.insight); only real notes count.
      db.select({ metadata: studyNotes.metadata }).from(studyNotes).where(eq(studyNotes.userId, userId)).limit(50),
      countRows("onboarding", () => db.select({ id: flashcards.id }).from(flashcards).where(eq(flashcards.userId, userId)).limit(1)),
      countRows("courses", () => db.select({ id: courses.id }).from(courses).where(eq(courses.userId, userId)).limit(1)),
      countRows("onboarding", () => db.select({ id: chatHistory.id }).from(chatHistory).where(and(eq(chatHistory.userId, userId), eq(chatHistory.role, "user"))).limit(1)),
    ]);
    return buildChecklist({
      recordings: recordingCount,
      latestCompletedRecordingId: latest[0]?.id ?? null,
      notes: notes.filter((row) => !(row.metadata as { insight?: unknown } | null)?.insight).length,
      flashcards: cards,
      courses: courseCount,
      questions,
    });
  }),
});
