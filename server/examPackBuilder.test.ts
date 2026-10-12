import { describe, expect, it } from "vitest";
import {
  buildGuideMessages,
  buildPackSources,
  defaultPackTitle,
  isAnswerCorrect,
  normalizeAnswer,
  normalizeQuizQuestions,
  scoreQuiz,
} from "./examPackBuilder";

const sources = [
  { n: 1, recordingId: 11, title: "Lecture 1", text: "" },
  { n: 2, recordingId: 22, title: "Lecture 2", text: "" },
];

describe("buildPackSources", () => {
  it("orders recordings oldest first and keeps the combined text within budget", () => {
    const long = Array.from({ length: 2000 }, (_, i) => ({ start: i * 15, text: "word ".repeat(40) }));
    const built = buildPackSources(
      [
        { recordingId: 2, title: "Second", createdAt: "2026-10-02", fullText: "word ".repeat(80_000), segments: long },
        { recordingId: 1, title: "First", createdAt: "2026-10-01", fullText: "short talk", segments: [{ start: 0, text: "short talk" }] },
      ],
      20_000,
    );
    expect(built.map(source => [source.n, source.recordingId])).toEqual([[1, 1], [2, 2]]);
    expect(built[0].text).toBe("[0:00] short talk");
    expect(built.reduce((sum, source) => sum + source.text.length, 0)).toBeLessThanOrEqual(20_000);
  });

  it("labels each recording in the guide prompt", () => {
    const [, user] = buildGuideMessages({ title: "Bio", sources: [{ ...sources[0], text: "[0:00] cells" }], meeting: false });
    expect(user.content).toContain("=== Recording 1: Lecture 1 ===");
    expect(user.content).toContain("[0:00] cells");
  });
});

describe("normalizeQuizQuestions", () => {
  it("keeps well-formed questions, fixes answer casing and maps sources to recordings", () => {
    const questions = normalizeQuizQuestions(
      {
        questions: [
          { question: "Where is ATP made?", type: "multiple-choice", options: ["Nucleus", "Mitochondria", "Ribosome", "Mitochondria"], correctAnswer: "mitochondria", explanation: "Powerhouse.", source: 2 },
          { question: "Name the cycle.", type: "short-answer", options: [], correctAnswer: "Krebs cycle", explanation: "", source: 9 },
          { question: "Bad", type: "multiple-choice", options: ["A", "B"], correctAnswer: "C", explanation: "", source: 1 },
          { question: "", type: "short-answer", options: [], correctAnswer: "x", explanation: "", source: 1 },
          { question: "Where is ATP made?", type: "short-answer", options: [], correctAnswer: "dup", explanation: "", source: 1 },
        ],
      },
      sources,
    );
    expect(questions).toEqual([
      { id: "q1", question: "Where is ATP made?", type: "multiple-choice", options: ["Nucleus", "Mitochondria", "Ribosome"], correctAnswer: "Mitochondria", explanation: "Powerhouse.", recordingId: 22 },
      { id: "q2", question: "Name the cycle.", type: "short-answer", correctAnswer: "Krebs cycle", explanation: "" },
    ]);
  });
});

describe("grading", () => {
  it("normalises case, accents, punctuation and articles", () => {
    expect(normalizeAnswer("  The Café-au-lait! ")).toBe("cafe au lait");
  });

  it("marks multiple choice only on the exact option", () => {
    expect(isAnswerCorrect({ type: "multiple-choice", correctAnswer: "Mitochondria" }, "mitochondria")).toBe(true);
    expect(isAnswerCorrect({ type: "multiple-choice", correctAnswer: "Mitochondria" }, "the mitochondria of cells")).toBe(false);
  });

  it("accepts a short answer that contains a short model answer", () => {
    expect(isAnswerCorrect({ type: "short-answer", correctAnswer: "Krebs cycle" }, "It is the Krebs cycle.")).toBe(true);
    expect(isAnswerCorrect({ type: "short-answer", correctAnswer: "Krebs cycle" }, "Calvin cycle")).toBe(false);
    expect(isAnswerCorrect({ type: "short-answer", correctAnswer: "Krebs cycle" }, "")).toBe(false);
  });

  it("scores a whole attempt", () => {
    const result = scoreQuiz(
      [
        { id: "q1", question: "", type: "multiple-choice", options: ["A", "B"], correctAnswer: "A", explanation: "" },
        { id: "q2", question: "", type: "short-answer", correctAnswer: "osmosis", explanation: "" },
      ],
      { q1: "A", q2: "diffusion" },
    );
    expect(result).toEqual({ correct: 1, total: 2, score: 50, results: [{ id: "q1", correct: true }, { id: "q2", correct: false }] });
  });
});

describe("defaultPackTitle", () => {
  it("names the course when there is one", () => {
    expect(defaultPackTitle("Cell Biology", 5, new Date(2026, 9, 12))).toBe("Cell Biology exam pack");
    expect(defaultPackTitle(null, 3, new Date(2026, 9, 12))).toBe("Exam pack: 3 recordings, 12 Oct");
  });
});
