/**
 * Flashcard ordering, shared by Learn and Test. Learn shows cards that are not
 * mastered yet, least-reviewed first; Test shuffles every card. Review status
 * is the web's: new -> learning -> mastered.
 */
export type ReviewStatus = "new" | "learning" | "mastered";
export type Card = { id: number; question: string; answer: string };
export type Review = { flashcardId: number; status: ReviewStatus; reviewCount?: number };

export function learnQueue(cards: Card[], reviews: Review[]): Card[] {
  const byId = new Map(reviews.map((review) => [review.flashcardId, review]));
  const rank = (card: Card) => {
    const review = byId.get(card.id);
    if (!review || review.status === "new") return 0;
    if (review.status === "learning") return 1;
    return 2;
  };
  return cards.filter((card) => rank(card) < 2).sort((a, b) => rank(a) - rank(b) || (byId.get(a.id)?.reviewCount ?? 0) - (byId.get(b.id)?.reviewCount ?? 0));
}

/** Knowing a card moves it on one step; not knowing it puts it back to learning. */
export function nextStatus(current: ReviewStatus | undefined, knewIt: boolean): ReviewStatus {
  if (!knewIt) return "learning";
  return current === "learning" ? "mastered" : current === "mastered" ? "mastered" : "learning";
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function masteryCounts(cards: Card[], reviews: Review[]) {
  const byId = new Map(reviews.map((review) => [review.flashcardId, review.status]));
  let mastered = 0;
  let learning = 0;
  for (const card of cards) {
    const status = byId.get(card.id);
    if (status === "mastered") mastered++;
    else if (status === "learning") learning++;
  }
  return { mastered, learning, fresh: cards.length - mastered - learning };
}
