import { describe, expect, it } from "vitest";
import { describeFollowUpDay } from "@shared/followUps";
import { buildFollowUpMessages, buildReminderMessage, normalizeFollowUps } from "./followUpExtraction";

describe("normalizeFollowUps", () => {
  it("dates items from today, clamps offsets, drops duplicates and sorts soonest first", () => {
    const raw = {
      items: [
        { kind: "practice", title: "Quiz yourself on the Krebs cycle", detail: "Use the flashcards.", inDays: 3 },
        { kind: "review", title: "Review glycolysis steps", detail: "Redraw the pathway.", inDays: 1 },
        { kind: "review", title: "review glycolysis steps!", detail: "dup", inDays: 2 },
        { kind: "ask", title: "Ask why NADH yields more ATP", detail: "", inDays: 40 },
        { kind: "nonsense", title: "Read chapter 9", detail: "x", inDays: -3 },
        { kind: "review", title: "  ", detail: "empty", inDays: 1 },
      ],
    };
    const items = normalizeFollowUps(raw, "2026-10-12");
    expect(items.map(item => [item.dueDate, item.kind, item.title])).toEqual([
      ["2026-10-12", "review", "Read chapter 9"],
      ["2026-10-13", "review", "Review glycolysis steps"],
      ["2026-10-15", "practice", "Quiz yourself on the Krebs cycle"],
      ["2026-10-26", "ask", "Ask why NADH yields more ATP"],
    ]);
    expect(items[3].detail).toBeNull();
  });

  it("keeps at most five", () => {
    const raw = { items: Array.from({ length: 9 }, (_, i) => ({ kind: "review", title: `Review topic ${i}`, detail: "", inDays: i })) };
    expect(normalizeFollowUps(raw, "2026-10-12")).toHaveLength(5);
  });

  it("returns nothing for unreadable output", () => {
    expect(normalizeFollowUps(null, "2026-10-12")).toEqual([]);
    expect(normalizeFollowUps({ items: "no" }, "2026-10-12")).toEqual([]);
  });
});

describe("buildFollowUpMessages", () => {
  it("mentions existing flashcards so practice can point at them", () => {
    const [system] = buildFollowUpMessages({ title: "Bio", audience: "student", transcript: "t", flashcardCount: 12 });
    expect(system.content).toContain("12 flashcards");
    const [none] = buildFollowUpMessages({ title: "Bio", audience: "student", transcript: "t", flashcardCount: 0 });
    expect(none.content).toContain("no flashcards");
  });
});

describe("buildReminderMessage", () => {
  it("names a single item and its recording", () => {
    expect(buildReminderMessage([{ title: "Review enzymes", recordingTitle: "Bio 5" }])).toEqual({ title: "Today's follow-up", body: "Review enzymes (Bio 5)" });
  });

  it("summarises several", () => {
    expect(buildReminderMessage([{ title: "A", recordingTitle: "x" }, { title: "B", recordingTitle: "y" }]).title).toBe("2 follow-ups for today");
  });
});

describe("describeFollowUpDay", () => {
  it("speaks in relative days", () => {
    expect(describeFollowUpDay("2026-10-12", "2026-10-12")).toBe("Today");
    expect(describeFollowUpDay("2026-10-13", "2026-10-12")).toBe("Tomorrow");
    expect(describeFollowUpDay("2026-10-19", "2026-10-12")).toBe("In 7 days");
    expect(describeFollowUpDay("2026-10-10", "2026-10-12")).toBe("2 days ago");
  });
});
