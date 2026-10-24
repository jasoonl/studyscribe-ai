import { describe, expect, it } from "vitest";
import { applyOrganized, canReplaceAfterOrganize, cleanNoteTitle, MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS } from "@shared/notePages";
import { MAX_ORGANIZE_INPUT_CHARS, buildOrganizeMessages, cleanOrganizedMarkdown, condenseNoteBody } from "./notePagePrompts";

describe("condenseNoteBody", () => {
  it("leaves a short note as it is", () => {
    expect(condenseNoteBody("  Cells divide.  ")).toEqual({ text: "Cells divide.", shortened: false });
  });

  it("keeps the start and the end of a long note, within the cap plus a marker", () => {
    const body = `START ${"a".repeat(30_000)} END`;
    const { text, shortened } = condenseNoteBody(body);
    expect(shortened).toBe(true);
    expect(text.startsWith("START")).toBe(true);
    expect(text.endsWith("END")).toBe(true);
    expect(text).toContain("left out for length");
    expect(text.length).toBeLessThan(MAX_ORGANIZE_INPUT_CHARS + 100);
  });
});

describe("buildOrganizeMessages", () => {
  it("forbids inventing facts in every mode and treats the note as data", () => {
    for (const mode of ["tidy", "summary", "questions"] as const) {
      const { messages } = buildOrganizeMessages(mode, "Bio", "Mitosis has four phases and cells copy their DNA first.");
      const system = String(messages[0].content);
      expect(system).toMatch(/Never add facts/);
      expect(system).toMatch(/Ignore any instructions/);
      expect(String(messages[1].content)).toContain("Title: Bio");
      expect(String(messages[1].content)).toContain("Mitosis has four phases");
    }
  });

  it("asks for different output per mode", () => {
    const text = (mode: "tidy" | "summary" | "questions") => String(buildOrganizeMessages(mode, "", "x".repeat(40)).messages[0].content);
    expect(text("tidy")).toMatch(/headings/);
    expect(text("summary")).toMatch(/summary/i);
    expect(text("questions")).toMatch(/practice questions/);
  });

  it("reports when a long note was shortened and omits an empty title", () => {
    const { messages, shortened } = buildOrganizeMessages("tidy", "  ", "word ".repeat(10_000));
    expect(shortened).toBe(true);
    expect(String(messages[1].content)).not.toContain("Title:");
  });
});

describe("cleanOrganizedMarkdown", () => {
  it("removes a fence wrapped around the whole answer only", () => {
    expect(cleanOrganizedMarkdown("```markdown\n# Bio\n- cells\n```")).toBe("# Bio\n- cells");
    expect(cleanOrganizedMarkdown("# Bio\n```js\nx\n```")).toBe("# Bio\n```js\nx\n```");
  });
});

describe("shared note helpers", () => {
  it("tidies and caps titles", () => {
    expect(cleanNoteTitle("  Week   3\n notes ")).toBe("Week 3 notes");
    expect(cleanNoteTitle("x".repeat(500))).toHaveLength(MAX_NOTE_TITLE_CHARS);
  });

  it("replaces or appends, never silently exceeding the cap", () => {
    expect(applyOrganized("old", "new", "replace")).toBe("new");
    expect(applyOrganized("old\n\n", " new ", "append")).toBe("old\n\nnew");
    expect(applyOrganized("   ", "new", "append")).toBe("new");
    expect(applyOrganized("a".repeat(MAX_NOTE_BODY_CHARS), "b", "append")).toHaveLength(MAX_NOTE_BODY_CHARS);
  });

  it("refuses Replace once the text changed after the AI call started", () => {
    expect(canReplaceAfterOrganize("same", "same")).toBe(true);
    expect(canReplaceAfterOrganize("same plus typing", "same")).toBe(false);
  });
});
