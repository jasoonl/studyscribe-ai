import { MIN_NOTES_CHARS, notesFileName, notesProblem, utf8Length } from "./notes";

describe("notesFileName", () => {
  it("names the file after the title", () => {
    expect(notesFileName("Chapter 4 notes")).toBe("Chapter 4 notes.txt");
  });
  it("removes characters that break file names and collapses spaces", () => {
    expect(notesFileName('  Bio: "Cells" / Week 3?  ')).toBe("Bio Cells Week 3.txt");
  });
  it("falls back to Notes and caps the length", () => {
    expect(notesFileName("   ")).toBe("Notes.txt");
    expect(notesFileName("///")).toBe("Notes.txt");
    expect(notesFileName("a".repeat(200))).toBe(`${"a".repeat(80)}.txt`);
  });
});

describe("notesProblem", () => {
  it("needs a minimum length", () => {
    expect(notesProblem("short")).toBe(`Paste at least ${MIN_NOTES_CHARS} characters of notes.`);
    expect(notesProblem(" ".repeat(30))).not.toBeNull();
    expect(notesProblem("x".repeat(MIN_NOTES_CHARS))).toBeNull();
  });
});

describe("utf8Length", () => {
  it("counts bytes", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("日本")).toBe(6);
    expect(utf8Length("😀")).toBe(4);
  });
});
