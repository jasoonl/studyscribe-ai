import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The test runner compiles JSX with the classic transform; the components need `React` in scope.
(globalThis as { React?: typeof React }).React = React;
const { ExamTimer } = await import("../components/practice/ExamTimer");
const { ExplanationCard } = await import("../components/practice/ExplanationCard");

describe("ExamTimer markup", () => {
  const html = renderToStaticMarkup(createElement(ExamTimer, { deadlineMs: Date.now() + 15 * 60_000, offsetMs: Date.now() - performance.now(), totalSeconds: 1800, onExpire: () => undefined }));
  it("keeps the visible clock silent and announces in separate regions", () => {
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
  });
  it("does not pair a changing label with aria-pressed", () => {
    expect(html).not.toContain("aria-pressed");
    expect(html).toContain("Hide timer");
  });
  it("shows dashes, not a frozen number, when the time from the server is broken", () => {
    const broken = renderToStaticMarkup(createElement(ExamTimer, { deadlineMs: Number.NaN, offsetMs: 0, totalSeconds: 1800, onExpire: () => undefined }));
    expect(broken).toContain("--:--");
  });
});

describe("ExplanationCard states", () => {
  const card = (state: Parameters<typeof ExplanationCard>[0]["state"]) => renderToStaticMarkup(createElement(ExplanationCard, { number: 2, state, canExplain: true, onExplain: () => undefined }));
  it("offers a labelled button when idle", () => {
    expect(card({ status: "idle" })).toContain("Explain why for question 2");
  });
  it("shows the honest not-covered text with no explanation", () => {
    const html = card({ status: "notCovered" });
    expect(html).toContain("do not cover this");
    expect(html).not.toContain("Explain why");
  });
  it("shows loading, and an error with Try again only when it can help", () => {
    expect(card({ status: "loading" })).toContain("Writing an explanation");
    expect(card({ status: "error", kind: "timeout", message: "" })).toContain("Try again for question 2");
    const capped = card({ status: "error", kind: "capReached", message: "" });
    expect(capped).toContain("most explanations");
    expect(capped).not.toContain("Try again");
    expect(card({ status: "error", kind: "usageLimit", message: "" })).not.toContain("Try again");
  });
  it("renders an explanation as plain text", () => {
    const html = card({ status: "ready", text: "Because <b>x</b> [1]", citations: [], cached: false });
    expect(html).toContain("Because &lt;b&gt;x&lt;/b&gt; [1]");
  });
});
