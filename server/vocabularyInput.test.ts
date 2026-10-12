import { describe, expect, it } from "vitest";
import { MAX_KEYTERMS_PER_JOB, mergeKeyterms, parseVocabulary } from "./vocabularyInput";

describe("parseVocabulary", () => {
  it("splits on lines, commas and semicolons, trims and drops repeats", () => {
    expect(parseVocabulary("Krebs cycle\n  mitochondria , Prof.  Okafor;krebs CYCLE\n\n")).toEqual(["Krebs cycle", "mitochondria", "Prof. Okafor"]);
  });

  it("drops entries the provider would reject", () => {
    expect(parseVocabulary(["x", "one two three four five six seven", "a".repeat(81), "ATP"])).toEqual(["ATP"]);
  });

  it("handles empty input", () => {
    expect(parseVocabulary("")).toEqual([]);
    expect(parseVocabulary(undefined)).toEqual([]);
  });
});

describe("mergeKeyterms", () => {
  it("puts recording terms first and caps the total", () => {
    expect(mergeKeyterms(["Okafor"], ["okafor", "ATP"])).toEqual(["Okafor", "ATP"]);
    const many = Array.from({ length: 300 }, (_, i) => `term${i}`);
    expect(mergeKeyterms(many.slice(0, 150), many.slice(150))).toHaveLength(MAX_KEYTERMS_PER_JOB);
  });
});
