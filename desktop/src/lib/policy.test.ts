import { describe, expect, it } from "vitest";
import {
  compactBounds,
  deepLinkPath,
  DEFAULT_ORIGIN,
  findDeepLink,
  isAllowedNavigation,
  isAllowedPermission,
  isAppUrl,
  isExternalLink,
  normalizeOrigin,
  resolveOrigin,
  studyHelpPath,
} from "./policy";
import { loopbackFor, pickScreen, systemAudioSupport } from "./systemAudio";

const LOCAL = "http://localhost:3107";

describe("origin", () => {
  it("accepts https origins and plain http only on this computer", () => {
    expect(normalizeOrigin("https://studyscribe-ai.vercel.app/")).toBe(DEFAULT_ORIGIN);
    expect(normalizeOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeOrigin("http://example.com")).toBeNull();
    expect(normalizeOrigin("https://example.com/path")).toBeNull();
    expect(normalizeOrigin("https://u:p@example.com")).toBeNull();
    expect(normalizeOrigin("file:///etc/passwd")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });

  it("prefers --url, then the environment, then the saved setting, then production", () => {
    expect(resolveOrigin({ argv: ["electron", ".", `--url=${LOCAL}`], env: "https://a.example", saved: "https://b.example" })).toBe(LOCAL);
    expect(resolveOrigin({ argv: [], env: "https://a.example", saved: "https://b.example" })).toBe("https://a.example");
    expect(resolveOrigin({ argv: [], env: undefined, saved: "https://b.example" })).toBe("https://b.example");
    expect(resolveOrigin({ argv: ["--url=http://evil.example"], env: "javascript:alert(1)", saved: undefined })).toBe(DEFAULT_ORIGIN);
  });
});

describe("navigation lock", () => {
  it("keeps the window on the app's origin and Google's sign-in page", () => {
    expect(isAllowedNavigation(`${LOCAL}/recording/4`, LOCAL)).toBe(true);
    expect(isAllowedNavigation("https://accounts.google.com/o/oauth2/v2/auth?x=1", LOCAL)).toBe(true);
    expect(isAllowedNavigation("http://accounts.google.com/", LOCAL)).toBe(false);
    expect(isAllowedNavigation("https://checkout.stripe.com/c/pay", LOCAL)).toBe(false);
    expect(isAllowedNavigation("http://localhost:3000/", LOCAL)).toBe(false);
    expect(isAllowedNavigation("https://localhost:3107.evil.com/", LOCAL)).toBe(false);
    expect(isAllowedNavigation("file:///etc/hosts", LOCAL)).toBe(false);
    expect(isAllowedNavigation("not a url", LOCAL)).toBe(false);
  });

  it("opens only web and mail links in the browser", () => {
    expect(isExternalLink("https://checkout.stripe.com/x")).toBe(true);
    expect(isExternalLink("mailto:help@example.com")).toBe(true);
    expect(isExternalLink("file:///Applications/Calculator.app")).toBe(false);
    expect(isExternalLink("smb://server/share")).toBe(false);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
  });

  it("recognises the app's own pages", () => {
    expect(isAppUrl(`${LOCAL}/`, LOCAL)).toBe(true);
    expect(isAppUrl("http://localhost:3108/", LOCAL)).toBe(false);
  });
});

describe("studyscribe:// links", () => {
  it("maps links to app paths", () => {
    expect(deepLinkPath("studyscribe://recording/12")).toBe("/recording/12");
    expect(deepLinkPath("studyscribe:///recording/12")).toBe("/recording/12");
    expect(deepLinkPath("studyscribe://record")).toBe("/record");
    expect(deepLinkPath("studyscribe://")).toBe("/dashboard");
    expect(deepLinkPath("studyscribe://recording/12?t=95")).toBe("/recording/12?t=95");
  });

  it("refuses API routes, odd characters and other schemes", () => {
    expect(deepLinkPath("studyscribe://api/auth/logout")).toBeNull();
    expect(deepLinkPath("studyscribe://recording/%2F%2Fevil.com")).toBeNull();
    expect(deepLinkPath("studyscribe://recording/1?next=https://evil.com")).toBeNull();
    expect(deepLinkPath("https://studyscribe-ai.vercel.app/recording/1")).toBeNull();
    expect(deepLinkPath("garbage")).toBeNull();
  });

  it("finds a link among command-line arguments (Windows and Linux)", () => {
    expect(findDeepLink(["/opt/StudyScribe/studyscribe", "--no-sandbox", "studyscribe://record"])).toBe("studyscribe://record");
    expect(findDeepLink(["app"])).toBeNull();
  });
});

describe("permissions", () => {
  it("allows the microphone, screen audio and notifications to the app only", () => {
    expect(isAllowedPermission("media", `${LOCAL}/record`, LOCAL, ["audio"])).toBe(true);
    expect(isAllowedPermission("display-capture", `${LOCAL}/record`, LOCAL)).toBe(true);
    expect(isAllowedPermission("notifications", LOCAL, LOCAL)).toBe(true);
    expect(isAllowedPermission("media", `${LOCAL}/record`, LOCAL, ["audio", "video"])).toBe(false);
    expect(isAllowedPermission("media", "https://accounts.google.com/", LOCAL, ["audio"])).toBe(false);
    expect(isAllowedPermission("geolocation", LOCAL, LOCAL)).toBe(false);
    expect(isAllowedPermission("openExternal", LOCAL, LOCAL)).toBe(false);
  });
});

describe("Study help window", () => {
  it("sits in the top-right corner of the work area", () => {
    expect(compactBounds({ x: 0, y: 25, width: 1440, height: 875 })).toEqual({ x: 1004, y: 41, width: 420, height: 680 });
    expect(compactBounds({ x: 1920, y: 0, width: 400, height: 600 })).toEqual({ x: 1936, y: 16, width: 368, height: 568 });
  });

  it("opens the record page unless a recorder page is showing", () => {
    expect(studyHelpPath(`${LOCAL}/dashboard`, LOCAL)).toBe("/record");
    expect(studyHelpPath(`${LOCAL}/record`, LOCAL)).toBeNull();
    expect(studyHelpPath(`${LOCAL}/record-or-upload`, LOCAL)).toBeNull();
    expect(studyHelpPath("file:///offline.html", LOCAL)).toBe("/record");
  });
});

describe("system audio", () => {
  it("uses loopback where the platform supports it", () => {
    expect(systemAudioSupport("win32")).toMatchObject({ available: true, method: "wasapi-loopback" });
    expect(systemAudioSupport("darwin", "24.1.0")).toMatchObject({ available: true, method: "screencapturekit" });
    expect(systemAudioSupport("darwin", "21.6.0")).toMatchObject({ available: false });
    expect(systemAudioSupport("linux")).toMatchObject({ available: true, method: "pulseaudio-monitor" });
    expect(systemAudioSupport("freebsd")).toMatchObject({ available: false });
    expect(loopbackFor(systemAudioSupport("win32"))).toBe("loopback");
    expect(loopbackFor(systemAudioSupport("freebsd"))).toBeUndefined();
  });

  it("shares the screen the window is on", () => {
    const sources = [
      { id: "window:1:0", name: "Zoom", display_id: "" },
      { id: "screen:1:0", name: "Screen 1", display_id: "1" },
      { id: "screen:2:0", name: "Screen 2", display_id: "2" },
    ];
    expect(pickScreen(sources, 2)?.id).toBe("screen:2:0");
    expect(pickScreen(sources, 9)?.id).toBe("screen:1:0");
    expect(pickScreen(sources)?.id).toBe("screen:1:0");
    expect(pickScreen([{ id: "window:1:0", name: "x" }])).toBeUndefined();
  });
});
