import { describe, expect, it } from "vitest";
import {
  buildAttendeeEmail,
  emailHash,
  fromHeader,
  isAttendeeEmailConfigured,
  planAttendeeSend,
  readUnsubscribeToken,
  safeNotesHtml,
  unsubscribeToken,
} from "./attendeeEmail";
import { normalizeAttendees } from "./recordingEvents";

describe("unsubscribe links", () => {
  it("names one address and cannot be forged or edited", () => {
    const token = unsubscribeToken("Ben@Example.com", "s1");
    expect(readUnsubscribeToken(token, "s1")).toBe("ben@example.com");
    expect(readUnsubscribeToken(token, "s2")).toBeNull();
    const [, signature] = token.split(".");
    const other = Buffer.from("victim@example.com").toString("base64url");
    expect(readUnsubscribeToken(`${other}.${signature}`, "s1")).toBeNull();
    expect(readUnsubscribeToken("garbage", "s1")).toBeNull();
  });
});

describe("who gets the notes", () => {
  const invited = normalizeAttendees([{ email: "ben@example.com", name: "Ben" }, { email: "cleo@example.com" }, { email: "ana@example.com" }], "ana@example.com");

  it("never includes the owner, duplicates or malformed addresses", () => {
    expect(invited.map(attendee => attendee.email)).toEqual(["ben@example.com", "cleo@example.com"]);
    expect(normalizeAttendees([{ email: "x" }, { email: "A@B.CO" }, { email: "a@b.co" }])).toEqual([{ email: "a@b.co", name: null }]);
  });

  it("skips everyone who opted out, whoever sends", () => {
    const plan = planAttendeeSend({ invited, requested: ["Ben@example.com", "cleo@example.com"], optedOut: new Set([emailHash("cleo@example.com")]) });
    expect(plan.send).toEqual(["ben@example.com"]);
    expect(plan.skipped).toEqual(["cleo@example.com"]);
    expect(plan.outsiders).toEqual([]);
  });

  it("refuses addresses that were not invited", () => {
    expect(planAttendeeSend({ invited, requested: ["stranger@example.com"], optedOut: new Set() }).outsiders).toEqual(["stranger@example.com"]);
  });

  it("hashes addresses case-insensitively, so the opt-out list holds no address", () => {
    expect(emailHash(" Ben@Example.com ")).toBe(emailHash("ben@example.com"));
    expect(emailHash("ben@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the email", () => {
  const built = buildAttendeeEmail({
    ownerName: "Ana Lopez",
    ownerEmail: "ana@example.com",
    title: "Weekly sync",
    notesMarkdown: "# Decisions\n- Ship <b>it</b>\n- [docs](https://example.com) and [bad](javascript:alert(1))",
    message: "Thanks <all>",
    recipient: "ben@example.com",
    postal: "1 Main St, Springfield",
    origin: "https://app.example",
  });

  it("carries a working opt-out link and the postal address (checklist item 18)", () => {
    expect(built.html).toContain("Don't email me from StudyScribe</a>");
    expect(built.unsubscribe).toMatch(/^https:\/\/app\.example\/unsubscribe\?token=/);
    expect(readUnsubscribeToken(decodeURIComponent(built.unsubscribe.split("token=")[1]))).toBe("ben@example.com");
    expect(built.html).toContain("1 Main St, Springfield");
    expect(built.text).toContain(built.unsubscribe);
  });

  it("escapes what people typed and drops unsafe links", () => {
    expect(built.html).toContain("Thanks &lt;all&gt;");
    expect(built.html).not.toContain("<b>it</b>");
    expect(safeNotesHtml("[x](javascript:alert) [y](https://ok.example)")).not.toMatch(/href="javascript/i);
    expect(built.html).not.toMatch(/href="javascript/i);
    expect(safeNotesHtml("[y](https://ok.example)")).toContain('href="https://ok.example"');
  });

  it("comes from the owner via StudyScribe, safely quoted", () => {
    expect(fromHeader("Ana Lopez", "notes@studyscribe.app")).toBe('"Ana Lopez via StudyScribe" <notes@studyscribe.app>');
    expect(fromHeader('Eve "<x>"\r\nBcc: a@b.c', "StudyScribe <notes@studyscribe.app>")).not.toMatch(/[\r\n<>]x|Bcc: a@b\.c>/);
  });

  it("is off until Resend and a postal address are configured", () => {
    expect(isAttendeeEmailConfigured({ RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "a@b.c" } as any)).toBe(false);
    expect(isAttendeeEmailConfigured({ RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "a@b.c", EMAIL_POSTAL_ADDRESS: "1 Main St" } as any)).toBe(true);
  });
});
