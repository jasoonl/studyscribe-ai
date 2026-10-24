// Mirrors client/src/lib/sourceLocation.ts; keep in step. English only.

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

const KIND_WORD: Record<LocationKind, string> = { page: "Page", slide: "Slide", section: "Section" };

/** "Slide 7: Title"; an unknown label is shown as the server wrote it. */
export function formatLocation(label: string | null | undefined): string {
  const parsed = parseLocation(label);
  if (!parsed) return label?.trim() ?? "";
  const base = `${KIND_WORD[parsed.kind]} ${parsed.n}`;
  const title = parsed.title?.replace(/\s*\(cont\.\)$/i, "").trim();
  const text = title ? `${base}: ${title}` : base;
  return parsed.continued ? `${text} (continued)` : text;
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

/** Character range of `quote` inside `text`, ignoring case and runs of whitespace. Null when not found. */
export function findQuote(text: string, quote: string | null | undefined): [number, number] | null {
  const needle = quote?.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
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
