import { describe, expect, it } from "vitest";
import { applyTurnMessage, groupParagraphs, liveTranscriptText, liveWindowText, settleSession, splitLiveText, type LiveTurn, type StreamingTurnMessage } from "./liveTurns";

const session0 = { index: 0, offsetSeconds: 0 };

function turn(order: number, transcript: string, options: Partial<StreamingTurnMessage> & { startMs?: number; endMs?: number } = {}): StreamingTurnMessage {
  const { startMs, endMs, ...rest } = options;
  return {
    type: "Turn",
    turn_order: order,
    transcript,
    end_of_turn: false,
    turn_is_formatted: false,
    words: startMs !== undefined && endMs !== undefined ? [{ start: startMs, end: endMs }] : undefined,
    ...rest,
  };
}

describe("applyTurnMessage", () => {
  it("replaces partials for the same turn rather than appending", () => {
    let turns: LiveTurn[] = [];
    turns = applyTurnMessage(turns, turn(0, "my name", { startMs: 1000, endMs: 1600 }), session0, 2);
    turns = applyTurnMessage(turns, turn(0, "my name is", { startMs: 1000, endMs: 2400 }), session0, 3);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ text: "my name is", final: false, startAt: 1, endAt: 2.4 });
  });

  it("finishes a turn only on the formatted final, ignoring the unformatted one before it", () => {
    let turns: LiveTurn[] = [];
    turns = applyTurnMessage(turns, turn(0, "my name is sonny", { end_of_turn: true }), session0, 3);
    expect(turns[0].final).toBe(false);
    turns = applyTurnMessage(turns, turn(0, "My name is Sonny.", { end_of_turn: true, turn_is_formatted: true }), session0, 3);
    expect(turns[0]).toMatchObject({ text: "My name is Sonny.", final: true });
    // A late partial cannot overwrite the finished text.
    const after = applyTurnMessage(turns, turn(0, "my name"), session0, 4);
    expect(after).toBe(turns);
  });

  it("keeps turns from different sessions apart and offsets their times", () => {
    let turns: LiveTurn[] = [];
    turns = applyTurnMessage(turns, turn(0, "First.", { end_of_turn: true, turn_is_formatted: true, startMs: 0, endMs: 1000 }), session0, 1);
    turns = applyTurnMessage(turns, turn(0, "After the pause.", { end_of_turn: true, turn_is_formatted: true, startMs: 500, endMs: 2000 }), { index: 1, offsetSeconds: 600 }, 602);
    expect(turns.map(t => [t.key, t.startAt, t.endAt])).toEqual([["0:0", 0, 1], ["1:0", 600.5, 602]]);
  });

  it("returns the same array when nothing changed, so React skips a render", () => {
    const turns = applyTurnMessage([], turn(0, "hello", { startMs: 0, endMs: 500 }), session0, 1);
    expect(applyTurnMessage(turns, turn(0, "hello", { startMs: 0, endMs: 500 }), session0, 1)).toBe(turns);
  });

  it("uses the recording clock when a message has no word timings", () => {
    const turns = applyTurnMessage([], turn(3, "no words"), { index: 2, offsetSeconds: 10 }, 42);
    expect(turns[0]).toMatchObject({ startAt: 42, endAt: 42 });
  });
});

describe("settleSession", () => {
  it("keeps the last partial text of a closed session as final and drops empty turns", () => {
    let turns: LiveTurn[] = [];
    turns = applyTurnMessage(turns, turn(0, "Done.", { end_of_turn: true, turn_is_formatted: true }), session0, 1);
    turns = applyTurnMessage(turns, turn(1, "half a sente"), session0, 2);
    turns = applyTurnMessage(turns, turn(2, ""), session0, 3);
    const settled = settleSession(turns, 0);
    expect(settled.map(t => [t.text, t.final])).toEqual([["Done.", true], ["half a sente", true]]);
  });
});

describe("splitLiveText", () => {
  it("separates the turn still being spoken", () => {
    let turns: LiveTurn[] = [];
    turns = applyTurnMessage(turns, turn(0, "One.", { end_of_turn: true, turn_is_formatted: true }), session0, 1);
    turns = applyTurnMessage(turns, turn(1, "two thr"), session0, 2);
    const { finals, partial } = splitLiveText(turns);
    expect(finals.map(t => t.text)).toEqual(["One."]);
    expect(partial?.text).toBe("two thr");
  });
});

describe("liveWindowText", () => {
  const turns: LiveTurn[] = [
    { key: "0:0", session: 0, order: 0, text: "Old part.", final: true, startAt: 0, endAt: 10 },
    { key: "0:1", session: 0, order: 1, text: "Middle part.", final: true, startAt: 200, endAt: 230 },
    { key: "0:2", session: 0, order: 2, text: "Latest words", final: false, startAt: 290, endAt: 300 },
  ];

  it("keeps the last N seconds measured from the latest words", () => {
    expect(liveWindowText(turns, 120, 1000)).toBe("Middle part. Latest words");
    expect(liveWindowText(turns, 600, 1000)).toBe("Old part. Middle part. Latest words");
  });

  it("caps the window from the end", () => {
    expect(liveWindowText(turns, 600, 14)).toBe("Latest words");
  });

  it("is empty with no speech", () => {
    expect(liveWindowText([], 120, 100)).toBe("");
  });

  it("joins everything for the full text", () => {
    expect(liveTranscriptText(turns)).toBe("Old part. Middle part. Latest words");
  });
});

describe("groupParagraphs", () => {
  const at = (key: string, startAt: number, endAt: number): LiveTurn => ({ key, session: 0, order: 0, text: key, final: true, startAt, endAt });

  it("breaks on pauses and long runs", () => {
    const turns = [at("a", 0, 2), at("b", 3, 5), at("c", 12, 14), at("d", 14, 15), at("e", 15, 16)];
    expect(groupParagraphs(turns, 4, 2).map(p => p.turns.map(t => t.key))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(groupParagraphs(turns, 4, 2)[1].startAt).toBe(12);
  });

  it("skips empty turns", () => {
    expect(groupParagraphs([{ ...at("x", 0, 1), text: "" }])).toEqual([]);
  });
});
