import { describe, expect, it } from "vitest";
import { buildChecklist } from "./onboarding";

const empty = { recordings: 0, latestCompletedRecordingId: null, notes: 0, flashcards: 0, courses: 0, questions: 0 };

describe("onboarding checklist", () => {
  it("starts with nothing done and sends recording-page steps to the recorder", () => {
    const list = buildChecklist(empty);
    expect(list).toMatchObject({ done: 0, total: 5 });
    expect(list.steps.map((step) => step.id)).toEqual(["record", "notes", "flashcards", "course", "ask"]);
    expect(list.steps.find((step) => step.id === "notes")?.action).toEqual({ kind: "recorder", label: "Record first" });
  });

  it("ticks steps off from real data and links to the latest finished recording", () => {
    const list = buildChecklist({ ...empty, recordings: 1, latestCompletedRecordingId: 12, notes: 1, courses: 1 });
    expect(list.done).toBe(3);
    expect(list.steps.find((step) => step.id === "flashcards")).toMatchObject({ done: false, action: { kind: "link", href: "/recording/12" } });
    expect(list.steps.find((step) => step.id === "ask")?.action).toMatchObject({ href: "/ask" });
  });

  it("is complete when every step is done", () => {
    expect(buildChecklist({ recordings: 2, latestCompletedRecordingId: 3, notes: 1, flashcards: 4, courses: 1, questions: 1 }).done).toBe(5);
  });
});
