import { describe, expect, it } from "vitest";
import en from "../../../shared/i18n/en";

describe("study source messages", () => {
  const keys = Object.keys(en);
  it("every plural base has both forms", () => {
    const bases = keys.filter(key => /^(sources|ask)\..*_one$/.test(key)).map(key => key.replace(/_one$/, ""));
    expect(bases.length).toBeGreaterThan(5);
    for (const base of bases) expect(keys, base).toContain(`${base}_other`);
  });
  it("covers every status, kind, flag kind and failure reason the UI can show", () => {
    for (const suffix of ["status.waiting", "status.reading", "status.summarizing", "status.ready", "status.failed", "kind.pdf", "kind.pptx", "kind.docx", "kind.text", "flag.definition", "flag.formula", "flag.date", "flag.example", "flag.exam_point", "importance.1", "importance.2", "importance.3", "reason.needsOcr", "reason.tooLarge", "reason.tooLong", "reason.unreadable", "reason.limitReached", "reason.failed"]) {
      expect(keys, suffix).toContain(`sources.${suffix}`);
    }
  });
});
