/**
 * Follow-up suggestions after a recording (C7): a short study plan for the
 * days after a lecture or meeting ("Review these concepts tomorrow").
 */
export const FOLLOW_UP_KINDS = ["review", "practice", "ask", "read"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const FOLLOW_UP_KIND_LABELS: Record<FollowUpKind, string> = {
  review: "Review",
  practice: "Practise",
  ask: "Ask",
  read: "Read up",
};

export const MAX_FOLLOW_UPS = 5;
export const MAX_FOLLOW_UP_TITLE = 160;
export const MAX_FOLLOW_UP_DETAIL = 500;
/** Suggestions are spread over the next two weeks at most. */
export const MAX_FOLLOW_UP_DAYS = 14;

/** "Today", "Tomorrow", "In 3 days", "Yesterday", "4 days ago". */
export function describeFollowUpDay(dueDate: string, todayIso: string): string {
  const [y1, m1, d1] = todayIso.split("-").map(Number);
  const [y2, m2, d2] = dueDate.split("-").map(Number);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}
