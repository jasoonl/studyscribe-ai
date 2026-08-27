import { describe, expect, it } from "vitest";
import { customNotificationInputSchema, dismissNotificationInputSchema } from "./notificationInput";

describe("custom notification input", () => {
  it("accepts a valid self-notification and trims its contents", () => {
    const result = customNotificationInputSchema.parse({
      title: "  Review chapter three  ",
      message: "  Revisit the key concepts before the quiz.  ",
      type: "warning",
      recordingId: 8,
    });

    expect(result).toEqual({
      title: "Review chapter three",
      message: "Revisit the key concepts before the quiz.",
      type: "warning",
      recordingId: 8,
    });
  });

  it("rejects empty messages, invalid categories, and malformed recording references", () => {
    expect(() => customNotificationInputSchema.parse({ title: " ", message: "Remember this" })).toThrow();
    expect(() => customNotificationInputSchema.parse({ title: "Reminder", message: " ", type: "custom" })).toThrow();
    expect(() => customNotificationInputSchema.parse({ title: "Reminder", message: "Study", recordingId: 0 })).toThrow();
  });

  it("accepts a positive notification ID for dismissal and rejects malformed IDs", () => {
    expect(dismissNotificationInputSchema.parse({ id: 24 })).toEqual({ id: 24 });
    expect(() => dismissNotificationInputSchema.parse({ id: 0 })).toThrow();
    expect(() => dismissNotificationInputSchema.parse({ id: 1.5 })).toThrow();
  });
});
