/**
 * Colour keys for courses and tags. The database stores the key; the client
 * maps it to a design token (`--course-<key>` in client/src/index.css), so a
 * theme change never leaves stale colour values in the data.
 */
export const COURSE_COLOR_KEYS = ["blue", "teal", "green", "amber", "rose", "violet", "slate"] as const;

export type CourseColorKey = (typeof COURSE_COLOR_KEYS)[number];

export const DEFAULT_COURSE_COLOR: CourseColorKey = "blue";

export function isCourseColorKey(value: unknown): value is CourseColorKey {
  return typeof value === "string" && (COURSE_COLOR_KEYS as readonly string[]).includes(value);
}

/** Anything unknown (including tags saved before keys existed, like "#3B82F6") falls back to the default. */
export function resolveCourseColor(value: unknown): CourseColorKey {
  return isCourseColorKey(value) ? value : DEFAULT_COURSE_COLOR;
}
