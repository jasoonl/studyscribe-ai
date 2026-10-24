import { describe, expect, it } from "vitest";
import { PART_MAX_CHARS, PLANNER_VERSION, planParts, renderPartForModel, type PlanUnit } from "./sourceParts";

const unit = (unitIndex: number, size: number, label = `Slide ${unitIndex + 1}`): PlanUnit => ({ unitIndex, label, text: `${unitIndex}`.repeat(size) });

describe("planParts", () => {
  it("returns no parts for no units", () => {
    expect(planParts([])).toEqual([]);
  });

  it("packs consecutive units without splitting one", () => {
    const units = [unit(0, 4000), unit(1, 4000), unit(2, 4000), unit(3, 500), unit(4, 8000)];
    const parts = planParts(units);
    expect(parts.map(part => [part.unitStart, part.unitEnd])).toEqual([[0, 1], [2, 3], [4, 4]]);
    expect(parts.map(part => part.index)).toEqual([0, 1, 2]);
    // Every unit lands in exactly one part, in order.
    expect(parts.flatMap(part => part.units.map(u => u.unitIndex))).toEqual([0, 1, 2, 3, 4]);
    expect(parts.every(part => part.units.length === 1 || part.text.length <= PART_MAX_CHARS + 200)).toBe(true);
  });

  it("gives a unit longer than the limit a part of its own", () => {
    const parts = planParts([unit(0, 100), unit(1, 12_000), unit(2, 100)], 9_000);
    expect(parts.map(part => part.units.length)).toEqual([1, 1, 1]);
  });

  it("renders units with their index and label for the model", () => {
    const text = renderPartForModel([unit(11, 3, "Slide 12: Title")]);
    expect(text).toBe("### [U11] Slide 12: Title\n111111");
  });

  it("has a stable hash that includes the planner version", () => {
    const units = [unit(0, 50), unit(1, 50)];
    const [a] = planParts(units);
    const [b] = planParts(units.map(u => ({ ...u })));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(PLANNER_VERSION).toBeGreaterThan(0);
  });

  it("changes only the hash of the part whose unit changed", () => {
    const before = [unit(0, 4000), unit(1, 4000), unit(2, 4000), unit(3, 4000)];
    const after = before.map(u => (u.unitIndex === 3 ? { ...u, text: u.text.replace("3", "x") } : u));
    const a = planParts(before);
    const b = planParts(after);
    expect(a).toHaveLength(2);
    expect(b[0].hash).toBe(a[0].hash);
    expect(b[1].hash).not.toBe(a[1].hash);
  });
});
