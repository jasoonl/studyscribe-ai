/**
 * Assembles the streaming service's `Turn` messages into a running live
 * transcript. Each turn is sent many times while it grows (partials), and each
 * message replaces the previous one for that turn; a turn is finished when a
 * message has both `end_of_turn` and `turn_is_formatted` set. `turn_order`
 * restarts at 0 in every session (after a pause, a reconnect or the hourly
 * rollover), so turns are keyed by session as well.
 *
 * Times are seconds into the recording: the session's offset (the recording
 * clock when the session started) plus the word timings, which count from the
 * start of the session's audio.
 */
import { keepTail } from "@shared/liveAssist";

export type LiveTurn = {
  key: string;
  session: number;
  order: number;
  text: string;
  final: boolean;
  startAt: number;
  endAt: number;
};

export type StreamingWord = { start?: number; end?: number; text?: string };
export type StreamingTurnMessage = {
  type: "Turn";
  turn_order: number;
  transcript?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  words?: StreamingWord[];
};

export type LiveSessionClock = { index: number; offsetSeconds: number };

/** Turns kept in memory; about three hours of lecture. */
export const MAX_LIVE_TURNS = 3000;

function wordTimes(words: StreamingWord[] | undefined): { start: number; end: number } | null {
  if (!words || words.length === 0) return null;
  const starts = words.map(word => word.start).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ends = words.map(word => word.end).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (starts.length === 0 || ends.length === 0) return null;
  return { start: Math.min(...starts) / 1000, end: Math.max(...ends) / 1000 };
}

/**
 * Applies one Turn message. Returns a new array (for React state) or the same
 * array when nothing changed. `nowSeconds` dates a turn that has no word timings.
 */
export function applyTurnMessage(turns: LiveTurn[], message: StreamingTurnMessage, session: LiveSessionClock, nowSeconds: number): LiveTurn[] {
  if (typeof message.turn_order !== "number") return turns;
  const key = `${session.index}:${message.turn_order}`;
  const text = (message.transcript ?? "").replace(/\s+/g, " ").trim();
  const final = Boolean(message.end_of_turn && message.turn_is_formatted);
  const times = wordTimes(message.words);

  // Turns arrive in order, so the one being updated is almost always last.
  let index = -1;
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 4; i--) {
    if (turns[i].key === key) {
      index = i;
      break;
    }
  }
  if (index === -1) index = turns.findIndex(turn => turn.key === key);
  const existing = index >= 0 ? turns[index] : null;
  // A finished turn only changes if another formatted final arrives for it.
  if (existing?.final && !final) return turns;

  const startAt = times ? session.offsetSeconds + times.start : existing?.startAt ?? nowSeconds;
  const endAt = times ? session.offsetSeconds + times.end : Math.max(existing?.endAt ?? nowSeconds, startAt);
  const next: LiveTurn = { key, session: session.index, order: message.turn_order, text, final, startAt, endAt };

  if (existing) {
    if (existing.text === next.text && existing.final === next.final && existing.endAt === next.endAt) return turns;
    const copy = turns.slice();
    copy[index] = next;
    return copy;
  }
  const appended = [...turns, next];
  return appended.length > MAX_LIVE_TURNS ? appended.slice(appended.length - MAX_LIVE_TURNS) : appended;
}

/**
 * When a session ends, whatever it last said for an unfinished turn is the
 * best text there will be; keep it as final, and drop empty turns.
 */
export function settleSession(turns: LiveTurn[], sessionIndex: number): LiveTurn[] {
  let changed = false;
  const next: LiveTurn[] = [];
  for (const turn of turns) {
    if (turn.session !== sessionIndex || turn.final) {
      next.push(turn);
      continue;
    }
    changed = true;
    if (turn.text) next.push({ ...turn, final: true });
  }
  return changed ? next : turns;
}

/** The finished text plus the turn still being spoken, for display. */
export function splitLiveText(turns: LiveTurn[]): { finals: LiveTurn[]; partial: LiveTurn | null } {
  const visible = turns.filter(turn => turn.text);
  const last = visible[visible.length - 1];
  if (last && !last.final) return { finals: visible.slice(0, -1), partial: last };
  return { finals: visible, partial: null };
}

/**
 * The text of roughly the last `windowSeconds` of speech, measured back from
 * the latest words (so a quiet minute does not empty the window), capped at
 * `maxChars` from the end.
 */
export function liveWindowText(turns: LiveTurn[], windowSeconds: number, maxChars: number): string {
  const visible = turns.filter(turn => turn.text);
  if (visible.length === 0) return "";
  const latest = Math.max(...visible.map(turn => turn.endAt));
  const from = latest - windowSeconds;
  const inWindow = visible.filter(turn => turn.endAt >= from);
  return keepTail(inWindow.map(turn => turn.text).join(" "), maxChars);
}

export function liveTranscriptText(turns: LiveTurn[]): string {
  return turns.filter(turn => turn.text).map(turn => turn.text).join(" ");
}

/**
 * Groups finished turns into readable paragraphs: a new one starts after a
 * pause of `gapSeconds` or once a paragraph holds `maxTurns` turns.
 */
export function groupParagraphs(turns: LiveTurn[], gapSeconds = 4, maxTurns = 5): Array<{ key: string; startAt: number; turns: LiveTurn[] }> {
  const paragraphs: Array<{ key: string; startAt: number; turns: LiveTurn[] }> = [];
  let current: { key: string; startAt: number; turns: LiveTurn[] } | null = null;
  let lastEnd = -Infinity;
  for (const turn of turns) {
    if (!turn.text) continue;
    if (!current || turn.startAt - lastEnd >= gapSeconds || current.turns.length >= maxTurns) {
      current = { key: turn.key, startAt: turn.startAt, turns: [] };
      paragraphs.push(current);
    }
    current.turns.push(turn);
    lastEnd = Math.max(lastEnd, turn.endAt);
  }
  return paragraphs;
}
