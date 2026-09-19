import { describe, expect, it } from "vitest";
import { checkTrpcRateLimit } from "./rateLimit";

describe("checkTrpcRateLimit", () => {
  it("allows requests up to the limit and then blocks within the window", () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      expect(checkTrpcRateLimit(key, 60_000, 3)).toBe(true);
    }
    expect(checkTrpcRateLimit(key, 60_000, 3)).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test:${crypto.randomUUID()}`;
    const keyB = `test:${crypto.randomUUID()}`;
    expect(checkTrpcRateLimit(keyA, 60_000, 1)).toBe(true);
    expect(checkTrpcRateLimit(keyA, 60_000, 1)).toBe(false);
    expect(checkTrpcRateLimit(keyB, 60_000, 1)).toBe(true);
  });

  it("resets the count after the window elapses", async () => {
    const key = `test:${crypto.randomUUID()}`;
    expect(checkTrpcRateLimit(key, 10, 1)).toBe(true);
    expect(checkTrpcRateLimit(key, 10, 1)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkTrpcRateLimit(key, 10, 1)).toBe(true);
  });
});
