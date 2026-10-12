/**
 * "Study help" during a live recording (A2): short questions about the last
 * few minutes of the live transcript. Shared so the client's buttons, the
 * window it sends and the server's limits agree.
 */
export const LIVE_ASSIST_ACTIONS = ["explain", "recap", "examFocus", "questions", "custom"] as const;
export type LiveAssistAction = (typeof LIVE_ASSIST_ACTIONS)[number];

export const LIVE_ASSIST_ACTION_INFO: Record<LiveAssistAction, { label: string; windowSeconds: number; pending: string }> = {
  explain: { label: "Explain a term", windowSeconds: 180, pending: "Explaining" },
  recap: { label: "Recap last 2 min", windowSeconds: 120, pending: "Recapping" },
  examFocus: { label: "Likely exam points", windowSeconds: 300, pending: "Looking for exam points" },
  questions: { label: "Questions to ask", windowSeconds: 300, pending: "Thinking of questions" },
  custom: { label: "Ask your own question", windowSeconds: 300, pending: "Answering" },
};

/** Characters of live transcript sent per request (about five minutes of speech). */
export const MAX_LIVE_ASSIST_WINDOW_CHARS = 6_000;
export const MAX_LIVE_ASSIST_QUESTION_CHARS = 300;
/** Below this there is too little to work with. */
export const MIN_LIVE_ASSIST_WINDOW_CHARS = 40;

/**
 * Keeps the end of `text`, at most `maxChars` long, starting on a word
 * boundary so the model never sees half a word.
 */
export function keepTail(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(clean.length - maxChars);
  const space = cut.indexOf(" ");
  return space > 0 && space < 40 ? cut.slice(space + 1) : cut;
}
