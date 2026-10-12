import { useEffect, type ReactNode } from "react";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";

/**
 * Links like /pricing#faq load the page before React has rendered the section, so the browser's
 * own jump to the anchor finds nothing. Look for it again for a few frames after mounting.
 */
export function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let frame = 0;
    let tries = 0;
    const seek = () => {
      const target = document.getElementById(id);
      if (target) target.scrollIntoView();
      else if (++tries < 60) frame = requestAnimationFrame(seek);
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, []);
}

export default function PublicLayout({ children }: { children: ReactNode }) {
  useScrollToHash();
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <SiteNav />
      <main className="pt-24">{children}</main>
      <SiteFooter />
    </div>
  );
}
