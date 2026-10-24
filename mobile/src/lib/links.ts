/**
 * Maps a web path (from a push notification's data.url, a universal link, or
 * a share) to the app screen that shows the same thing. The app's routes use
 * the web's paths on purpose, so most map one to one.
 */
const APP_ROUTES: RegExp[] = [
  /^\/recording\/\d+$/,
  /^\/courses\/\d+$/,
  /^\/sources\/\d+$/,
  /^\/exam-packs(\/\d+)?$/,
  /^\/shared-with-me(\/\d+)?$/,
  /^\/tasks$/,
  /^\/ask$/,
  /^\/settings$/,
  /^\/notifications$/,
  /^\/trash$/,
  /^\/reset-password$/,
  /^\/signup$/,
];

const SOURCE_TABS = ["summary", "points", "pages"];

export function appPathForWebPath(input: string | null | undefined): string {
  if (!input) return "/";
  let path = input;
  let search = "";
  try {
    const url = new URL(input, "https://studyscribe.invalid");
    path = url.pathname.replace(/\/+$/, "") || "/";
    search = url.search;
  } catch {
    return "/";
  }
  if (path === "/" || path === "/dashboard") return "/";
  if (path === "/invite") return `/signup${search}`;
  // The course's sources live at /course-sources/:id (a folder next to courses/[id].tsx would clash).
  const courseSources = /^\/courses\/(\d+)\/sources$/.exec(path);
  if (courseSources) return `/course-sources/${courseSources[1]}`;
  const match = /^\/recordings\/(\d+)\/(quizzes|study-guides|email-drafts)$/.exec(path);
  if (match) return `/recording/${match[1]}/${match[2] === "quizzes" ? "quiz" : match[2] === "study-guides" ? "guide" : "drafts"}`;
  if (APP_ROUTES.some((route) => route.test(path))) {
    // Only the query strings the app reads are kept.
    const params = new URLSearchParams(search);
    const kept = new URLSearchParams();
    for (const key of ["t", "token", "invite", "code", "email"]) {
      const value = params.get(key);
      if (value) kept.set(key, value);
    }
    if (path.startsWith("/sources/")) {
      const tab = params.get("tab");
      const page = params.get("page");
      const quote = params.get("q");
      if (tab && SOURCE_TABS.includes(tab)) kept.set("tab", tab);
      if (page && /^\d{1,5}$/.test(page)) kept.set("page", page);
      if (quote?.trim()) kept.set("q", quote.slice(0, 120));
    }
    const query = kept.toString();
    return query ? `${path}?${query}` : path;
  }
  return "/";
}
