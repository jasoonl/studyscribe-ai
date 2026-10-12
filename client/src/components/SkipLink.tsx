import type { MouseEvent } from "react";

/** First focusable element on every page: jumps keyboard users past the navigation to <main>. */
export default function SkipLink() {
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector("main");
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    main.scrollIntoView();
  };

  return (
    <a
      href="#main"
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Skip to main content
    </a>
  );
}
