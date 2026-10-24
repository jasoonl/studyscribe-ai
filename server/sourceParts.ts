import { createHash } from "crypto";

/**
 * Splits a source's units into parts small enough to analyse in one request
 * (the translations model: the browser asks for one part at a time, so no
 * request nears the 60s function limit). Pure; no database or network.
 */

/** Bump when the prompt or the planner changes, so stored parts are analysed again. */
export const PLANNER_VERSION = 1;
export const PART_MAX_CHARS = 9_000;

export type PlanUnit = { unitIndex: number; label: string; text: string };
export type PlannedPart = { index: number; unitStart: number; unitEnd: number; units: PlanUnit[]; text: string; hash: string };

/** `### [U12] Slide 7: title` blocks, the form the model sees and cites by. */
export function renderPartForModel(units: PlanUnit[]): string {
  return units.map(unit => `### [U${unit.unitIndex}] ${unit.label}\n${unit.text}`).join("\n\n");
}

/** Packs consecutive units into parts of about `maxChars`. A unit is never split; one longer than the limit is a part of its own. */
export function planParts(units: PlanUnit[], maxChars = PART_MAX_CHARS): PlannedPart[] {
  const parts: PlannedPart[] = [];
  let group: PlanUnit[] = [];
  let length = 0;
  const close = () => {
    if (group.length === 0) return;
    const text = renderPartForModel(group);
    const unitStart = group[0].unitIndex;
    const unitEnd = group[group.length - 1].unitIndex;
    const hash = createHash("sha256").update(`v${PLANNER_VERSION}\n${unitStart}-${unitEnd}\n${text}`).digest("hex");
    parts.push({ index: parts.length, unitStart, unitEnd, units: group, text, hash });
    group = [];
    length = 0;
  };
  for (const unit of units) {
    const size = unit.label.length + unit.text.length + 16;
    if (group.length > 0 && length + size > maxChars) close();
    group.push(unit);
    length += size;
  }
  close();
  return parts;
}
