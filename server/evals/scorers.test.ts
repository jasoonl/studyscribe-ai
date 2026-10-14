import { describe, expect, it } from "vitest";
import { compareWithBaseline, contentTerms, coverage, grounding, keyTerms, scoreAsk, scoreFlashcards, scoreNotes, scoreQuiz } from "./scorers";

const transcript = `Entropy measures how many microscopic arrangements match what we observe.
In an isolated system entropy never decreases. That is the second law of thermodynamics.
A fridge is not isolated: it dumps entropy into the kitchen. Total entropy still rises.
Disorder is a loose picture of entropy; the precise idea counts microstates.`;

describe("terms", () => {
  it("drops stopwords and stems plurals", () => {
    expect(contentTerms("The reactions and the systems are isolated")).toEqual(["reaction", "system", "isolated"]);
  });
  it("finds the words a transcript repeats", () => {
    expect(keyTerms(transcript).slice(0, 2)).toEqual(["entropy", "isolated"]);
  });
});

describe("grounding and coverage", () => {
  it("scores grounded text high and invented text low", () => {
    expect(grounding("Entropy in an isolated system never decreases.", transcript)).toBe(1);
    expect(grounding("Photosynthesis converts sunlight into glucose.", transcript)).toBe(0);
  });
  it("measures how much of the lecture's subject the output covers", () => {
    expect(coverage("entropy isolated", transcript)).toBe(1);
    expect(coverage("nothing relevant", transcript)).toBe(0);
  });
});

describe("scoreNotes", () => {
  it("requires headings and some substance", () => {
    const good = `# Entropy\n\n${"Entropy counts microstates in an isolated system and never decreases there. ".repeat(6)}`;
    expect(scoreNotes(good, transcript).checks.every((c) => c.pass)).toBe(true);
    expect(scoreNotes("entropy", transcript).checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(["has headings", "not empty"]);
  });
});

describe("scoreFlashcards", () => {
  const card = (question: string, answer: string) => ({ question, answer });
  it("flags duplicates, giveaways and too few cards", () => {
    const result = scoreFlashcards([card("What never decreases?", "Entropy"), card("What never decreases?", "Entropy"), card("Is entropy disorder?", "entropy")], transcript);
    expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(["5 to 20 cards", "no duplicate questions", "answers not given away in the question"]);
  });
});

describe("scoreQuiz", () => {
  const q = (question: string, correctAnswer: string, options = ["Entropy", "Energy", "Heat"]) => ({ question, type: "multiple-choice", options, correctAnswer, explanation: "Said in the lecture." });
  it("checks the count, the answer key and the options", () => {
    const result = scoreQuiz([q("What never decreases?", "Entropy"), q("What is disorder?", "Microstates"), q("Two options?", "A", ["A", "a"])], transcript, 10);
    expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(["10 questions", "correct answer is one of the options", "at least 3 distinct options"]);
  });
});

describe("scoreAsk", () => {
  const titles = new Map([[1, "Thermodynamics"]]);
  it("checks recall and citations", () => {
    const result = scoreAsk({ answer: "Entropy never decreases in an isolated system [1].", citations: [{ recordingId: 1 }] }, { question: "?", expect: ["entropy", "isolated", "kelvin"], source: "Thermodynamics" }, titles);
    expect(result.scores.recall).toBeCloseTo(0.667);
    expect(result.checks.every((c) => c.pass)).toBe(true);
  });
  it("expects no citations for a question the library can't answer", () => {
    expect(scoreAsk({ answer: "I could not find that.", citations: [] }, { question: "?", expect: [] }, titles).checks[0].pass).toBe(true);
    expect(scoreAsk({ answer: "Made up [1]", citations: [{ recordingId: 1 }] }, { question: "?", expect: [] }, titles).checks[0].pass).toBe(false);
  });
});

describe("compareWithBaseline", () => {
  it("reports failed checks and scores that fell beyond the tolerance", () => {
    const problems = compareWithBaseline(
      [
        { id: "notes:a", scores: { grounding: 0.7, coverage: 0.55 }, checks: [{ name: "has headings", pass: false }] },
        { id: "new", scores: { grounding: 0.1 }, checks: [] },
      ],
      { "notes:a": { grounding: 0.75, coverage: 0.8 } },
    );
    expect(problems).toEqual(["notes:a: has headings", "notes:a: coverage fell from 0.8 to 0.55"]);
  });
});
