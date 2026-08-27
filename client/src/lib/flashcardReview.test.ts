import { describe, expect, it } from "vitest";
import { buildFlashcardReviewSummary } from "./flashcardReview";

const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];

describe("buildFlashcardReviewSummary", () => {
  it("places unseen cards in the new bucket and retains them in the review queue", () => {
    const summary = buildFlashcardReviewSummary(cards, []);

    expect(summary.counts).toEqual({ new: 3, learning: 0, mastered: 0 });
    expect(summary.reviewQueue.map((card) => card.id)).toEqual([1, 2, 3]);
  });

  it("removes mastered cards from the default queue while preserving learning cards", () => {
    const summary = buildFlashcardReviewSummary(cards, [
      { flashcardId: 1, status: "mastered" },
      { flashcardId: 2, status: "learning" },
    ]);

    expect(summary.counts).toEqual({ new: 1, learning: 1, mastered: 1 });
    expect(summary.reviewQueue.map((card) => card.id)).toEqual([2, 3]);
  });

  it("can include mastered cards when a learner chooses to revisit the full set", () => {
    const summary = buildFlashcardReviewSummary(
      cards,
      [{ flashcardId: 1, status: "mastered" }],
      true,
    );

    expect(summary.reviewQueue.map((card) => card.id)).toEqual([1, 2, 3]);
  });
});
