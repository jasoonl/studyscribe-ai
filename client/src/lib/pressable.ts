import type { KeyboardEvent } from "react";

/** Focus ring for elements made interactive with `pressable`. */
export const PRESSABLE_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * Props that let a card or row that reacts to clicks also be reached with Tab and used with
 * Enter (and Space, for buttons), and announce itself to screen readers. Prefer a real <button>
 * or link; use this where the element has to stay a container.
 */
export function pressable(onActivate: () => void, role: "button" | "link" = "button") {
  return {
    role,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || (role === "button" && event.key === " ")) {
        event.preventDefault();
        onActivate();
      }
    },
  };
}
