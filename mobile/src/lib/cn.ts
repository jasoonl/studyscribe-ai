import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Our font families (Geist weights) are families, not weights.
      "font-family": [{ font: ["sans", "medium", "semibold", "bold"] }],
    },
  },
});

/** Joins class names, letting later classes replace conflicting earlier ones (as cn() on the web). */
export function cn(...parts: (string | false | null | undefined)[]) {
  return merge(parts.filter(Boolean).join(" "));
}
