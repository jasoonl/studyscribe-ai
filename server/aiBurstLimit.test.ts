import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: async () => null }));

const { aiProcedure, AI_BURST_LIMIT } = await import("./usage");
const { router } = await import("./_core/trpc");

const testRouter = router({ ping: aiProcedure.mutation(() => "pong") });
const caller = (user: Record<string, unknown>) => testRouter.createCaller({ req: {} as any, res: {} as any, user: user as any });

describe("AI burst limit", () => {
  it("stops one account after the burst cap, whatever the plan limits say", async () => {
    const user = { id: 987_654, role: "user", email: "burst@example.com", loginMethod: "email", emailVerified: 1 };
    for (let i = 0; i < AI_BURST_LIMIT.max; i++) await expect(caller(user).ping()).resolves.toBe("pong");
    await expect(caller(user).ping()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("never limits admins", async () => {
    const admin = { id: 987_655, role: "admin", email: "admin@example.com", loginMethod: "email", emailVerified: 1 };
    for (let i = 0; i < AI_BURST_LIMIT.max + 5; i++) await expect(caller(admin).ping()).resolves.toBe("pong");
  });
});
