/**
 * Locations inside a study source. The server stores a unit label such as "Page 4", "Slide 7"
 * or "Section 2: Cell biology" (always English, always from the stored unit, never the model),
 * and a unit index. The UI words the label in the interface language and links to the unit.
 */

export type LocationKind = "page" | "slide" | "section";

export type ParsedLocation = { kind: LocationKind; n: number; title: string | null; continued: boolean };

const LABEL = /^(Page|Slide|Section)\s+(\d+)(?::\s*(.*?))?\s*(\(cont\.\))?$/i;

/** Splits a server label into its parts, or null for a label we do not recognise. */
export function parseLocation(label: string | null | undefined): ParsedLocation | null {
  if (!label) return null;
  const match = LABEL.exec(label.trim());
  if (!match) return null;
  const title = match[3]?.trim() || null;
  return {
    kind: match[1].toLowerCase() as LocationKind,
    n: Number.parseInt(match[2], 10),
    title,
    continued: Boolean(match[4]) || (title !== null && /\(cont\.\)$/i.test(title)),
  };
}

type Translate = (key: LocationKey, vars?: Record<string, string | number>) => string;
export type LocationKey = "sources.location.page" | "sources.location.slide" | "sources.location.section" | "sources.location.cont";

/** "Slide 7" in the interface language; an unknown label is shown as the server wrote it. */
export function formatLocation(label: string | null | undefined, t: Translate): string {
  const parsed = parseLocation(label);
  if (!parsed) return label?.trim() ?? "";
  const base = t(`sources.location.${parsed.kind}` as LocationKey, { n: parsed.n });
  const title = parsed.title?.replace(/\s*\(cont\.\)$/i, "").trim();
  const text = title ? `${base}: ${title}` : base;
  return parsed.continued ? `${text} ${t("sources.location.cont")}` : text;
}

export type SourceTab = "summary" | "points" | "pages";

/**
 * Where a source opens. `unitIndex` is 0-based on the server; the address carries the 1-based
 * number people read (`page=4`). `q` is a short quote to highlight on the page.
 */
export function sourceHref(sourceId: number, options: { unitIndex?: number | null; quote?: string | null; tab?: SourceTab } = {}): string {
  const params = new URLSearchParams();
  const unit = options.unitIndex;
  if (typeof unit === "number" && Number.isInteger(unit) && unit >= 0) {
    params.set("tab", "pages");
    params.set("page", String(unit + 1));
  } else if (options.tab) {
    params.set("tab", options.tab);
  }
  const quote = options.quote?.replace(/\s+/g, " ").trim().slice(0, 120);
  if (quote && params.has("page")) params.set("q", quote);
  const query = params.toString();
  return `/sources/${sourceId}${query ? `?${query}` : ""}`;
}

/** The 0-based unit index for a `page` address value, or null when it is missing or invalid. */
export function unitFromPageParam(value: string | null | undefined, unitCount: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const index = Number.parseInt(value, 10) - 1;
  return index >= 0 && index < unitCount ? index : null;
}

/** Character ranges of `quote` inside `text`, ignoring case and runs of whitespace. Empty when not found. */
export function findQuote(text: string, quote: string | null | undefined): [number, number] | null {
  const needle = quote?.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  // Map each character of a whitespace-collapsed copy back to its place in the original.
  let collapsed = "";
  const map: number[] = [];
  let previousSpace = false;
  for (let i = 0; i < text.length; i++) {
    const isSpace = /\s/.test(text[i]);
    if (isSpace && previousSpace) continue;
    collapsed += isSpace ? " " : text[i].toLowerCase();
    map.push(i);
    previousSpace = isSpace;
  }
  const at = collapsed.indexOf(needle);
  if (at < 0) return null;
  return [map[at], map[at + needle.length - 1] + 1];
}
