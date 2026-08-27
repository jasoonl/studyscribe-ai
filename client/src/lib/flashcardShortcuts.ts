export type FlashcardShortcutAction = "toggle" | "learning" | "mastered" | null;

type ShortcutTarget = {
  tagName?: string;
  isContentEditable?: boolean;
} | null | undefined;

export function isTypingTarget(target: ShortcutTarget) {
  const tagName = target?.tagName?.toLowerCase();
  return target?.isContentEditable === true || tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function getFlashcardShortcutAction({
  key,
  isRevealed,
  isSubmitting,
  target,
}: {
  key: string;
  isRevealed: boolean;
  isSubmitting: boolean;
  target?: ShortcutTarget;
}): FlashcardShortcutAction {
  if (isSubmitting || isTypingTarget(target)) return null;
  if (key === " " || key === "Spacebar") return "toggle";
  if (!isRevealed) return null;
  if (key === "ArrowLeft") return "learning";
  if (key === "ArrowRight") return "mastered";
  return null;
}
