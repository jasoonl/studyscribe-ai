import { useEffect } from "react";
import { useLocation } from "wouter";
import { PLANS } from "@shared/plans";
import { metaForPath, softwareApplicationJsonLd } from "@shared/seo";

function setMeta(attribute: "name" | "property", key: string, content: string | null) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (content === null) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setCanonical(href: string | null) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

const JSON_LD_ID = "software-application-jsonld";
const LOWEST_PAID = Math.min(...PLANS.filter(plan => plan.priceMonthlyUsd > 0).map(plan => plan.priceMonthlyUsd));

/**
 * A small head manager: on every navigation it sets the title, description,
 * Open Graph tags, one canonical link for public pages, noindex elsewhere,
 * and the SoftwareApplication structured data on the landing page.
 */
export default function RouteMeta() {
  const [location] = useLocation();
  useEffect(() => {
    const meta = metaForPath(location);
    // The recorder puts the elapsed time in the title while recording; leave it alone then.
    if (!/(Recording|Paused) [\d:]+ · StudyScribe$/.test(document.title)) document.title = meta.title;
    setMeta("name", "description", meta.description);
    setMeta("property", "og:title", meta.title);
    setMeta("property", "og:description", meta.description);
    setMeta("property", "og:url", meta.canonical);
    setMeta("name", "robots", meta.index ? null : "noindex");
    setCanonical(meta.canonical);

    const existing = document.getElementById(JSON_LD_ID);
    if (location === "/") {
      const script = existing ?? Object.assign(document.createElement("script"), { id: JSON_LD_ID, type: "application/ld+json" });
      script.textContent = JSON.stringify(softwareApplicationJsonLd(LOWEST_PAID));
      if (!existing) document.head.appendChild(script);
    } else {
      existing?.remove();
    }
  }, [location]);
  return null;
}
