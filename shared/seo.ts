/**
 * Search metadata for the public pages (Phase 6). `RouteMeta` applies it on
 * every navigation (title, description, Open Graph, one canonical link per
 * public route), `client/public/sitemap.xml` lists the same paths (a test
 * keeps them in step), and every other route is marked noindex.
 *
 * SITE_ORIGIN is the canonical address. When the app moves to a custom
 * domain, change it here, in sitemap.xml and robots.txt, in index.html's
 * og:image, and in getSafeApplicationOrigin (server/email.ts).
 */
export const SITE_ORIGIN = "https://studyscribe-ai.vercel.app";
export const SITE_NAME = "StudyScribe AI";

export type PageMeta = { title: string; description: string };

export const DEFAULT_META: PageMeta = {
  title: "StudyScribe AI: lecture and meeting transcripts with study tools",
  description: "Record or upload a lecture or meeting. StudyScribe transcribes it with speaker labels and builds notes, flashcards, quizzes and study guides from what was said.",
};

export const PUBLIC_PAGES: Record<string, PageMeta> = {
  "/": DEFAULT_META,
  "/pricing": {
    title: "Pricing · StudyScribe AI",
    description: "Free to start. Paid plans add transcription hours and AI help each month, billed monthly or yearly, and you can cancel any time.",
  },
  "/demo": {
    title: "See it work · StudyScribe AI",
    description: "A short walkthrough: record a class, get a transcript with speakers, then notes, flashcards and a practice quiz.",
  },
  "/developers": {
    title: "Developer API · StudyScribe AI",
    description: "Personal API keys and REST endpoints for recordings, transcripts, notes and flashcards, plus signed webhooks and Slack or Discord delivery.",
  },
  "/request-access": {
    title: "Request access · StudyScribe AI",
    description: "Ask for an invitation to StudyScribe AI.",
  },
  "/terms": { title: "Terms of Service · StudyScribe AI", description: "The terms for using StudyScribe AI." },
  "/privacy": { title: "Privacy Policy · StudyScribe AI", description: "What StudyScribe AI collects, why, who processes it and how to delete it." },
  "/cookies": { title: "Cookie Policy · StudyScribe AI", description: "The cookies and browser storage StudyScribe AI uses, and how consent works." },
  "/refunds": { title: "Refund Policy · StudyScribe AI", description: "How cancelling and refunds work for StudyScribe AI plans." },
  "/credits": { title: "Credits · StudyScribe AI", description: "Open-source software and media used by StudyScribe AI." },
};

export function metaForPath(pathname: string): PageMeta & { canonical: string | null; index: boolean } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const meta = PUBLIC_PAGES[path];
  if (meta) return { ...meta, canonical: `${SITE_ORIGIN}${path === "/" ? "/" : path}`, index: true };
  // Sign-in pages, shared links and everything behind sign-in stay out of search.
  return { ...DEFAULT_META, canonical: null, index: false };
}

/** SoftwareApplication structured data for the landing page. */
export function softwareApplicationJsonLd(lowestPaidUsd: number) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web, Chrome, Windows, macOS, iOS, Android",
    url: SITE_ORIGIN,
    description: DEFAULT_META.description,
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
      { "@type": "Offer", price: String(lowestPaidUsd), priceCurrency: "USD", name: "Paid plans from", category: "subscription" },
    ],
  };
}
