import { describe, expect, it } from "vitest";
import { checkImportableUrl, DEFAULT_ORIGIN, isSameOrigin, normalizeOrigin, originPermissionPattern, siteUrl } from "./origin";

describe("normalizeOrigin", () => {
  it("accepts the production site with or without the scheme and a trailing slash", () => {
    expect(normalizeOrigin("https://studyscribe-ai.vercel.app/")).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
    expect(normalizeOrigin("  studyscribe-ai.vercel.app ")).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
    expect(normalizeOrigin("HTTPS://StudyScribe-AI.vercel.app")).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
  });

  it("keeps a port", () => {
    expect(normalizeOrigin("https://example.edu:8443")).toEqual({ ok: true, origin: "https://example.edu:8443" });
  });

  it("allows plain HTTP only for this computer", () => {
    expect(normalizeOrigin("http://localhost:3107")).toEqual({ ok: true, origin: "http://localhost:3107" });
    expect(normalizeOrigin("http://127.0.0.1:3000")).toEqual({ ok: true, origin: "http://127.0.0.1:3000" });
    expect(normalizeOrigin("http://example.com")).toMatchObject({ ok: false });
    expect(normalizeOrigin("http://localhost.evil.com")).toMatchObject({ ok: false });
  });

  it("refuses paths, queries, credentials and other schemes", () => {
    expect(normalizeOrigin("https://example.com/app")).toMatchObject({ ok: false });
    expect(normalizeOrigin("https://example.com/?next=1")).toMatchObject({ ok: false });
    expect(normalizeOrigin("https://example.com/#x")).toMatchObject({ ok: false });
    expect(normalizeOrigin("https://user:pw@example.com")).toMatchObject({ ok: false });
    expect(normalizeOrigin("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(normalizeOrigin("ftp://example.com")).toMatchObject({ ok: false });
    expect(normalizeOrigin("")).toMatchObject({ ok: false });
    expect(normalizeOrigin("not a url at all")).toMatchObject({ ok: false });
  });
});

describe("originPermissionPattern", () => {
  it("drops the port, since Chrome match patterns cannot hold one", () => {
    expect(originPermissionPattern("https://studyscribe-ai.vercel.app")).toBe("https://studyscribe-ai.vercel.app/*");
    expect(originPermissionPattern("http://localhost:3107")).toBe("http://localhost/*");
  });
});

describe("checkImportableUrl", () => {
  const origin = DEFAULT_ORIGIN;

  it("accepts ordinary web pages and media links", () => {
    expect(checkImportableUrl("https://ocw.mit.edu/courses/lecture-1/", origin)).toEqual({ ok: true, url: "https://ocw.mit.edu/courses/lecture-1/" });
    expect(checkImportableUrl("http://example.com/talk.mp3", origin)).toMatchObject({ ok: true });
  });

  it("refuses browser pages, StudyScribe itself and credentials", () => {
    expect(checkImportableUrl("chrome://extensions", origin)).toMatchObject({ ok: false });
    expect(checkImportableUrl("chrome-extension://abc/popup.html", origin)).toMatchObject({ ok: false });
    expect(checkImportableUrl("file:///Users/me/lecture.mp3", origin)).toMatchObject({ ok: false });
    expect(checkImportableUrl(`${origin}/recording/4`, origin)).toMatchObject({ ok: false, reason: "This is a StudyScribe page already." });
    expect(checkImportableUrl("https://me:secret@example.com/a.mp3", origin)).toMatchObject({ ok: false });
    expect(checkImportableUrl(undefined, origin)).toMatchObject({ ok: false });
    expect(checkImportableUrl(`https://example.com/${"a".repeat(2100)}`, origin)).toMatchObject({ ok: false });
  });
});

describe("siteUrl and isSameOrigin", () => {
  it("builds links that stay on the site", () => {
    expect(siteUrl("http://localhost:3107", "/recording/12")).toBe("http://localhost:3107/recording/12");
    expect(() => siteUrl(DEFAULT_ORIGIN, "//evil.com/x")).toThrow();
    expect(() => siteUrl(DEFAULT_ORIGIN, "https://evil.com")).toThrow();
  });

  it("compares scheme, host and port", () => {
    expect(isSameOrigin("http://localhost:3107/api/x", "http://localhost:3107")).toBe(true);
    expect(isSameOrigin("http://localhost:3000/api/x", "http://localhost:3107")).toBe(false);
    expect(isSameOrigin("https://studyscribe-ai.vercel.app.evil.com/", DEFAULT_ORIGIN)).toBe(false);
    expect(isSameOrigin("garbage", DEFAULT_ORIGIN)).toBe(false);
  });
});
