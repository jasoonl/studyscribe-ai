import { appPathForWebPath } from "./links";

describe("study source links", () => {
  it("opens a source at its page with a highlight", () => {
    expect(appPathForWebPath("https://studyscribe.app/sources/12?tab=pages&page=4&q=cell%20membrane")).toBe("/sources/12?tab=pages&page=4&q=cell+membrane");
    expect(appPathForWebPath("/sources/12")).toBe("/sources/12");
  });
  it("maps a course's sources to the app route", () => {
    expect(appPathForWebPath("/courses/7/sources")).toBe("/course-sources/7");
    expect(appPathForWebPath("/courses/7")).toBe("/courses/7");
  });
  it("keeps only valid source query values", () => {
    expect(appPathForWebPath("/sources/3?tab=admin&page=abc")).toBe("/sources/3");
    expect(appPathForWebPath("/sources/3?tab=summary&page=99999999")).toBe("/sources/3?tab=summary");
    expect(appPathForWebPath("/sources/3?tab=points&evil=1")).toBe("/sources/3?tab=points");
  });
  it("caps a hostile q at 120 characters", () => {
    const result = appPathForWebPath(`/sources/3?tab=pages&page=1&q=${"a".repeat(500)}`);
    expect(new URLSearchParams(result.split("?")[1]).get("q")).toHaveLength(120);
  });
  it("sends non-source paths with source params nowhere special", () => {
    expect(appPathForWebPath("/courses/7?tab=pages&page=2")).toBe("/courses/7");
    expect(appPathForWebPath("/sources/abc")).toBe("/");
    expect(appPathForWebPath("/sources/1/extra")).toBe("/");
  });
  it("keeps the existing mappings", () => {
    expect(appPathForWebPath("/recording/5?t=30")).toBe("/recording/5?t=30");
    expect(appPathForWebPath(null)).toBe("/");
  });
});
