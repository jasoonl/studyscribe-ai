import { describe, expect, it } from "vitest";
import { buildManifest } from "../manifest";
import { badgeText, defaultTitle, formatDuration, formatElapsed, formatRecordedDate, statusLabel } from "./format";

describe("time formatting", () => {
  it("formats elapsed time like the web recorder", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65.9)).toBe("1:05");
    expect(formatElapsed(3729)).toBe("1:02:09");
  });

  it("fits the badge in four characters", () => {
    expect(badgeText(42)).toBe("0:42");
    expect(badgeText(599)).toBe("9:59");
    expect(badgeText(754)).toBe("12m");
    expect(badgeText(3900)).toBe("1h05");
    expect(badgeText(11 * 3600)).toBe("11h");
    for (const s of [0, 59, 600, 3599, 3600, 35_999, 40_000]) expect(badgeText(s).length).toBeLessThanOrEqual(4);
  });

  it("describes recording lengths and dates", () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(40)).toBe("40 sec");
    expect(formatDuration(52 * 60)).toBe("52 min");
    expect(formatDuration(90 * 60)).toBe("1 hr 30 min");
    const now = new Date(2026, 9, 13, 12);
    expect(formatRecordedDate(new Date(2026, 9, 13, 8), now)).toBe("Today");
    expect(formatRecordedDate(new Date(2026, 9, 12, 23), now)).toBe("Yesterday");
    expect(formatRecordedDate("garbage", now)).toBe("");
    expect(statusLabel("completed")).toBe("Ready");
    expect(statusLabel("processing")).toBe("Transcribing");
  });

  it("titles a recording after its tab", () => {
    expect(defaultTitle("  Lecture 4:   Enzymes  ")).toBe("Lecture 4: Enzymes");
    expect(defaultTitle("", new Date(2026, 9, 13))).toMatch(/^Tab recording, /);
    expect(defaultTitle("x".repeat(400)).length).toBe(200);
  });
});

describe("manifest", () => {
  it("asks for the minimum permissions and only the StudyScribe host", () => {
    const manifest = buildManifest({ version: "1.2.3" });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["activeTab", "offscreen", "storage", "tabCapture"]);
    expect(manifest.host_permissions).toEqual(["https://studyscribe-ai.vercel.app/*"]);
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(manifest.name).toBe("StudyScribe AI");
  });

  it("adds a local server for development builds", () => {
    const manifest = buildManifest({ version: "1.0.0", devOrigin: "http://localhost:3107" });
    expect(manifest.host_permissions).toEqual(["https://studyscribe-ai.vercel.app/*", "http://localhost/*"]);
    expect(manifest.name).toMatch(/development/);
  });
});
