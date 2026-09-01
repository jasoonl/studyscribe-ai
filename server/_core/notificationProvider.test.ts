import { afterEach, describe, expect, it, vi } from "vitest";
import { getOwnerNotificationProvider } from "./notification";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("owner notification provider selection", () => {
  it("uses a project-owned webhook when configured for external hosting", () => {
    vi.stubEnv("OWNER_ALERT_WEBHOOK_URL", "https://hooks.example.com/studyscribe");
    expect(getOwnerNotificationProvider()).toEqual({ name: "webhook", url: "https://hooks.example.com/studyscribe" });
  });

  it("fails closed when an external alert endpoint is malformed", () => {
    vi.stubEnv("OWNER_ALERT_WEBHOOK_URL", "not-a-url");
    expect(getOwnerNotificationProvider()).toBeNull();
  });
});
