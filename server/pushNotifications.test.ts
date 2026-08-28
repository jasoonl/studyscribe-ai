import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserPushConfiguration } from "./pushNotifications";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browser push configuration", () => {
  it("does not expose a subscription key when VAPID configuration is incomplete", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");

    expect(getBrowserPushConfiguration()).toEqual({ supported: false, publicKey: null });
  });

  it("returns only the public VAPID key for an enabled browser subscription flow", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:support@example.com");

    expect(getBrowserPushConfiguration()).toEqual({ supported: true, publicKey: "public-key" });
  });
});
