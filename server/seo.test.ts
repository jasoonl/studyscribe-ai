import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES, SITE_ORIGIN, metaForPath, softwareApplicationJsonLd } from "@shared/seo";

const sitemap = readFileSync(new URL("../client/public/sitemap.xml", import.meta.url), "utf8");
const robots = readFileSync(new URL("../client/public/robots.txt", import.meta.url), "utf8");

describe("SEO basics", () => {
  it("lists exactly the public pages in the sitemap", () => {
    const listed = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map(match => match[1]);
    expect(listed.sort()).toEqual(Object.keys(PUBLIC_PAGES).map(path => `${SITE_ORIGIN}${path}`).sort());
  });

  it("points robots.txt at the sitemap and keeps the app out", () => {
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(robots).toMatch(/Disallow: \/api\//);
    expect(robots).toMatch(/Disallow: \/dashboard/);
  });

  it("gives public pages a canonical and everything else noindex", () => {
    expect(metaForPath("/pricing")).toMatchObject({ canonical: `${SITE_ORIGIN}/pricing`, index: true });
    expect(metaForPath("/pricing/")).toMatchObject({ canonical: `${SITE_ORIGIN}/pricing` });
    expect(metaForPath("/")).toMatchObject({ canonical: `${SITE_ORIGIN}/`, index: true });
    expect(metaForPath("/dashboard")).toMatchObject({ canonical: null, index: false });
    expect(metaForPath("/login")).toMatchObject({ canonical: null, index: false });
  });

  it("keeps titles and descriptions within what search results show, without em dashes", () => {
    for (const [path, meta] of Object.entries(PUBLIC_PAGES)) {
      expect(meta.title.length, path).toBeLessThanOrEqual(70);
      expect(meta.description.length, path).toBeLessThanOrEqual(170);
      expect(`${meta.title}${meta.description}`, path).not.toContain("—");
    }
  });

  it("describes the app as a SoftwareApplication", () => {
    const data = softwareApplicationJsonLd(5);
    expect(data["@type"]).toBe("SoftwareApplication");
    expect(data.offers[0]).toMatchObject({ price: "0", priceCurrency: "USD" });
    expect(data.offers[1].price).toBe("5");
  });
});
