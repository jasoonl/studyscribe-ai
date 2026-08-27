import { describe, expect, it } from "vitest";
import { buildAnswerOptions, buildTestQuestions, getLearnQuestionType, getLearnQueue, getLearnReviewStatus, isStudyAnswerCorrect, scoreMasteryTest } from "./masteryModes";

const cards = [
  { id: 1, question: "What is an atom?", answer: "The basic unit of matter" },
  { id: 2, question: "What is photosynthesis?", answer: "The process plants use to convert light into energy" },
  { id: 3, question: "What is gravity?", answer: "A force that attracts objects with mass" },
];

describe("mastery mode study logic", () => {
  it("prioritizes learning cards, then new cards, and omits mastered cards", () => {
    const queue = getLearnQueue(cards, [
      { flashcardId: 1, status: "new", reviewCount: 0 },
      { flashcardId: 2, status: "learning", reviewCount: 1 },
      { flashcardId: 3, status: "mastered", reviewCount: 2 },
    ]);
    expect(queue.map((card) => card.id)).toEqual([2, 1]);
  });

  it("uses multiple choice first and progresses learning cards to written recall", () => {
    expect(getLearnQuestionType()).toBe("multiple-choice");
    expect(getLearnQuestionType({ flashcardId: 1, status: "learning", reviewCount: 1 })).toBe("written");
    expect(getLearnReviewStatus(true, { flashcardId: 1, status: "learning", reviewCount: 1 })).toBe("mastered");
    expect(getLearnReviewStatus(false, { flashcardId: 1, status: "new", reviewCount: 0 })).toBe("learning");
  });

  it("builds usable options and grades normalized written answers", () => {
    const options = buildAnswerOptions(cards, cards[0], 1);
    expect(options).toContain(cards[0].answer);
    expect(options.length).toBeGreaterThan(1);
    expect(isStudyAnswerCorrect("basic unit of matter", "The basic unit of matter")).toBe(true);
    expect(isStudyAnswerCorrect("a plant", "The basic unit of matter")).toBe(false);
  });

  it("builds a mixed-format test and returns a transparent score", () => {
    const questions = buildTestQuestions(cards);
    expect(questions.map((question) => question.type)).toEqual(["multiple-choice", "multiple-choice", "written"]);
    const score = scoreMasteryTest(questions, {
      1: cards[0].answer,
      2: "incorrect answer",
      3: cards[2].answer,
    });
    expect(score).toMatchObject({ correct: 2, total: 3, percentage: 67 });
  });
});
