import type { FlashcardReviewState, FlashcardReviewStatus } from "./flashcardReview";

export interface MasteryCard {
  id: number;
  question: string;
  answer: string;
}

export type MasteryQuestionType = "multiple-choice" | "written";

export interface MasteryQuestion {
  card: MasteryCard;
  type: MasteryQuestionType;
  options?: string[];
}

function reviewForCard(reviews: FlashcardReviewState[], cardId: number) {
  return reviews.find((review) => review.flashcardId === cardId);
}

export function getLearnQueue<T extends MasteryCard>(cards: T[], reviews: FlashcardReviewState[]) {
  const rank: Record<FlashcardReviewStatus, number> = { learning: 0, new: 1, mastered: 2 };
  return cards
    .filter((card) => (reviewForCard(reviews, card.id)?.status ?? "new") !== "mastered")
    .sort((left, right) => {
      const leftReview = reviewForCard(reviews, left.id);
      const rightReview = reviewForCard(reviews, right.id);
      const statusDifference = rank[leftReview?.status ?? "new"] - rank[rightReview?.status ?? "new"];
      if (statusDifference !== 0) return statusDifference;
      return (leftReview?.reviewCount ?? 0) - (rightReview?.reviewCount ?? 0);
    });
}

export function getLearnQuestionType(review?: FlashcardReviewState): MasteryQuestionType {
  return review?.status === "learning" && (review.reviewCount ?? 0) > 0 ? "written" : "multiple-choice";
}

export function buildAnswerOptions<T extends MasteryCard>(cards: T[], currentCard: T, rotation = 0) {
  const choices = [
    currentCard.answer,
    ...cards
      .filter((card) => card.id !== currentCard.id && card.answer.trim().toLowerCase() !== currentCard.answer.trim().toLowerCase())
      .map((card) => card.answer),
  ].slice(0, 4);

  if (choices.length < 2) return choices;
  const offset = ((rotation % choices.length) + choices.length) % choices.length;
  return [...choices.slice(offset), ...choices.slice(0, offset)];
}

export function normalizeStudyAnswer(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStudyAnswerCorrect(answer: string, expectedAnswer: string) {
  const normalizedAnswer = normalizeStudyAnswer(answer);
  const normalizedExpected = normalizeStudyAnswer(expectedAnswer);
  if (!normalizedAnswer || !normalizedExpected) return false;
  if (normalizedAnswer === normalizedExpected) return true;

  const answerWords = normalizedAnswer.split(" ");
  const expectedWords = normalizedExpected.split(" ");
  const overlap = answerWords.filter((word) => expectedWords.includes(word)).length;
  return answerWords.length >= 2 && overlap / answerWords.length >= 0.8;
}

export function getLearnReviewStatus(isCorrect: boolean, priorReview?: FlashcardReviewState): "learning" | "mastered" {
  if (!isCorrect) return "learning";
  return priorReview?.status === "learning" && (priorReview.reviewCount ?? 0) >= 1 ? "mastered" : "learning";
}

export function buildTestQuestions<T extends MasteryCard>(cards: T[]): MasteryQuestion[] {
  return cards.map((card, index) => {
    const type: MasteryQuestionType = index % 3 === 2 ? "written" : "multiple-choice";
    return {
      card,
      type,
      options: type === "multiple-choice" ? buildAnswerOptions(cards, card, index) : undefined,
    };
  });
}

export function scoreMasteryTest(questions: MasteryQuestion[], answers: Record<number, string>) {
  const results = questions.map((question) => ({
    flashcardId: question.card.id,
    correct: isStudyAnswerCorrect(answers[question.card.id] ?? "", question.card.answer),
  }));
  const correct = results.filter((result) => result.correct).length;
  return { correct, total: questions.length, percentage: questions.length ? Math.round((correct / questions.length) * 100) : 0, results };
}
