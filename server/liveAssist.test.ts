import { describe, expect, it } from "vitest";
import { MAX_LIVE_ASSIST_WINDOW_CHARS, keepTail } from "@shared/liveAssist";
import { buildLiveAssistInstruction, buildLiveAssistMessages, liveAssistProblem } from "./liveAssist";

const WINDOW = "Today we are talking about photosynthesis. The light reactions happen in the thylakoid membrane and make ATP and NADPH.";

describe("keepTail", () => {
  it("keeps short text whole, collapsing whitespace", () => {
    expect(keepTail("  a   b \n c ", 100)).toBe("a b c");
  });

  it("keeps the end and starts on a whole word", () => {
    const text = "alpha beta gamma delta epsilon";
    const tail = keepTail(text, 12);
    expect(text.endsWith(tail)).toBe(true);
    expect(tail).toBe("epsilon");
  });
});

describe("buildLiveAssistMessages", () => {
  it("sends the excerpt and the action's instruction, never more than the window cap", () => {
    const long = `${"word ".repeat(3000)}the end`;
    const messages = buildLiveAssistMessages({ action: "recap", transcriptWindow: long, windowSeconds: 120 });
    expect(messages[0].role).toBe("system");
    const user = messages[1].content as string;
    expect(user).toContain("the last 2 minutes");
    expect(user).toContain("Recap what was said");
    expect(user).toContain("the end");
    expect(user.length).toBeLessThan(MAX_LIVE_ASSIST_WINDOW_CHARS + 400);
  });

  it("frames the system prompt around learning, not answering graded work", () => {
    const [system] = buildLiveAssistMessages({ action: "questions", transcriptWindow: WINDOW });
    expect(system.content).toMatch(/Never write answers for them to pass off/);
  });

  it("explains a named term when one is given", () => {
    expect(buildLiveAssistInstruction("explain", "thylakoid")).toContain('"thylakoid"');
    expect(buildLiveAssistInstruction("explain", undefined)).toMatch(/Pick the most important/);
  });

  it("words meeting help differently", () => {
    expect(buildLiveAssistInstruction("examFocus", undefined, "professional")).toMatch(/following up/);
    expect(buildLiveAssistInstruction("examFocus", undefined, "student")).toMatch(/exam/);
  });
});

describe("liveAssistProblem", () => {
  it("needs a question for custom", () => {
    expect(liveAssistProblem({ action: "custom", transcriptWindow: WINDOW })).toMatch(/Type a question/);
    expect(liveAssistProblem({ action: "custom", transcriptWindow: WINDOW, question: "What is ATP?" })).toBeNull();
  });

  it("needs some transcript to work with", () => {
    expect(liveAssistProblem({ action: "recap", transcriptWindow: "hello" })).toMatch(/enough live transcript/);
  });
});
