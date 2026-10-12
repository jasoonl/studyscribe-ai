/** Shared by the server (validation) and the to-do views (grouping, labels). */

export const ACTION_ITEM_KINDS = ["task", "assignment", "exam", "reading"] as const;
export type ActionItemKind = (typeof ACTION_ITEM_KINDS)[number];

export const ACTION_ITEM_KIND_LABELS: Record<ActionItemKind, string> = {
  task: "Task",
  assignment: "Assignment",
  exam: "Exam or test",
  reading: "Reading",
};

export const MAX_ACTION_ITEM_TEXT = 500;

/** A real calendar day written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The local calendar day of `date` as YYYY-MM-DD. */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  const toUtc = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}

export type DueGroupId = "overdue" | "today" | "week" | "later" | "undated" | "done";

export const DUE_GROUP_LABELS: Record<DueGroupId, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Next 7 days",
  later: "Later",
  undated: "No date",
  done: "Done",
};

type Groupable = { id: number; done: boolean; dueDate: string | null; createdAt?: Date | string };

/**
 * Buckets items for the to-do view. Open items with a date sort by date, the
 * rest keep their order; done items go last whatever their date.
 */
export function groupActionItems<T extends Groupable>(items: T[], todayIso: string): Array<{ id: DueGroupId; items: T[] }> {
  const groups: Record<DueGroupId, T[]> = { overdue: [], today: [], week: [], later: [], undated: [], done: [] };
  for (const item of items) {
    if (item.done) groups.done.push(item);
    else if (!item.dueDate || !isIsoDate(item.dueDate)) groups.undated.push(item);
    else {
      const days = daysBetween(todayIso, item.dueDate);
      if (days < 0) groups.overdue.push(item);
      else if (days === 0) groups.today.push(item);
      else if (days <= 7) groups.week.push(item);
      else groups.later.push(item);
    }
  }
  const byDate = (a: T, b: T) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id - b.id;
  for (const id of ["overdue", "today", "week", "later"] as const) groups[id].sort(byDate);
  return (Object.keys(groups) as DueGroupId[]).filter(id => groups[id].length > 0).map(id => ({ id, items: groups[id] }));
}

/** "Tomorrow", "Fri 17 Oct", "3 days ago" style label for a due date. */
export function describeDueDate(dueDate: string, todayIso: string): string {
  const days = daysBetween(todayIso, dueDate);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0 && days > -14) return `${-days} days ago`;
  const [year, month, day] = dueDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const sameYear = todayIso.slice(0, 4) === dueDate.slice(0, 4);
  return date.toLocaleDateString(undefined, { weekday: days > 0 && days < 7 ? "short" : undefined, day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}
