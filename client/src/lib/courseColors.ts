import { COURSE_COLOR_KEYS, resolveCourseColor, type CourseColorKey } from "@shared/courseColors";

export { COURSE_COLOR_KEYS, resolveCourseColor };
export type { CourseColorKey };

/** Written out in full so Tailwind sees every class name. */
export const COURSE_DOT_CLASS: Record<CourseColorKey, string> = {
  blue: "bg-course-blue",
  teal: "bg-course-teal",
  green: "bg-course-green",
  amber: "bg-course-amber",
  rose: "bg-course-rose",
  violet: "bg-course-violet",
  slate: "bg-course-slate",
};

export const COURSE_COLOR_LABEL: Record<CourseColorKey, string> = {
  blue: "Blue",
  teal: "Teal",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  violet: "Violet",
  slate: "Slate",
};

export function courseDotClass(color: unknown): string {
  return COURSE_DOT_CLASS[resolveCourseColor(color)];
}
