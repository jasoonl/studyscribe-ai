export type FlashcardReviewStatus = "new" | "learning" | "mastered";

export interface FlashcardReviewState {
  flashcardId: number;
  status: FlashcardReviewStatus;
}

export interface ReviewableFlashcard {
  id: number;
}

export function buildFlashcardReviewSummary<T extends ReviewableFlashcard>(
  cards: T[],
  reviews: FlashcardReviewState[],
  includeMastered = false,
) {
  const reviewByCardId = new Map(reviews.map((review) => [review.flashcardId, review.status]));
  const counts: Record<FlashcardReviewStatus, number> = { new: 0, learning: 0, mastered: 0 };

  cards.forEach((card) => {
    counts[reviewByCardId.get(card.id) ?? "new"] += 1;
  });

  const reviewQueue = includeMastered
    ? cards
    : cards.filter((card) => reviewByCardId.get(card.id) !== "mastered");

  return { reviewQueue, counts };
}
