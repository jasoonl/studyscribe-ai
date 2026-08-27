import { describe, expect, it } from "vitest";
import { getFlashcardShortcutAction, isTypingTarget } from "./flashcardShortcuts";

describe("flashcard keyboard shortcuts", () => {
  it("uses Space to toggle a flashcard before and after reveal", () => {
    expect(getFlashcardShortcutAction({ key: " ", isRevealed: false, isSubmitting: false })).toBe("toggle");
    expect(getFlashcardShortcutAction({ key: " ", isRevealed: true, isSubmitting: false })).toBe("toggle");
  });

  it("maps arrow keys to the intended revealed-card mastery actions", () => {
    expect(getFlashcardShortcutAction({ key: "ArrowLeft", isRevealed: true, isSubmitting: false })).toBe("learning");
    expect(getFlashcardShortcutAction({ key: "ArrowRight", isRevealed: true, isSubmitting: false })).toBe("mastered");
    expect(getFlashcardShortcutAction({ key: "ArrowRight", isRevealed: false, isSubmitting: false })).toBeNull();
  });

  it("does not intercept keys while typing or while a review save is pending", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(getFlashcardShortcutAction({ key: "ArrowLeft", isRevealed: true, isSubmitting: false, target: { tagName: "INPUT" } })).toBeNull();
    expect(getFlashcardShortcutAction({ key: "ArrowRight", isRevealed: true, isSubmitting: true })).toBeNull();
  });
});
