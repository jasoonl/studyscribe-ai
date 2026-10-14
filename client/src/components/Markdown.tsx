import { lazy, Suspense, useEffect, useRef, useState } from "react";

/**
 * Markdown for notes, guides, answers and drafts. Streamdown (with its
 * syntax highlighting and diagram support) is about 700 KB, so it loads only
 * once Markdown is actually on screen: text in a hidden tab (the notes tab is
 * mounted while another tab shows) stays plain until it is shown. Until then
 * the text shows as plain paragraphs, so nothing jumps or disappears.
 */
const Streamdown = lazy(() => import("streamdown").then(module => ({ default: module.Streamdown })));

function Plain({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap">{children}</p>;
}

export function Markdown({ children }: { children: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div ref={ref}>
        <Plain>{children}</Plain>
      </div>
    );
  }
  return (
    <Suspense fallback={<Plain>{children}</Plain>}>
      <Streamdown>{children}</Streamdown>
    </Suspense>
  );
}
